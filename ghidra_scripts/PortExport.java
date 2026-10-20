// Port RE: exports reconstructed pseudocode and assembly, never original source.
//@category PortRE
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.listing.Instruction;
import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;

public class PortExport extends GhidraScript {
    @Override public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 1) throw new IllegalArgumentException("Missing output directory");
        Path output = Paths.get(args[0]);
        Files.createDirectories(output);
        int limit = args.length > 1 ? Integer.parseInt(args[1]) : 1000;
        if (limit < 1 || limit > 10000) throw new IllegalArgumentException("Function limit out of range");
        int discovered = 0;
        FunctionIterator count = currentProgram.getFunctionManager().getFunctions(true);
        while (count.hasNext()) if (!count.next().isExternal()) discovered++;
        JsonArray functions = new JsonArray();
        DecompInterface decompiler = new DecompInterface();
        if (!decompiler.openProgram(currentProgram)) throw new IOException("Decompiler could not open the program: " + decompiler.getLastMessage());
        int attempted = 0, passed = 0, failed = 0, warningFunctions = 0;
        long exportedChars = 0;
        boolean sizeLimit = false;
        try (BufferedWriter c = Files.newBufferedWriter(output.resolve("pseudocode.c"), StandardCharsets.UTF_8);
             BufferedWriter assembly = Files.newBufferedWriter(output.resolve("disassembly.txt"), StandardCharsets.UTF_8)) {
            c.write("/* Port RE / Ghidra: reconstructed pseudocode.\n * This is not the complete original source, and is not guaranteed to compile.\n * Missing names, types, logic and unsupported instructions require manual analysis.\n */\n\n");
            FunctionIterator iterator = currentProgram.getFunctionManager().getFunctions(true);
            while (iterator.hasNext() && attempted < limit && !monitor.isCancelled()) {
                Function function = iterator.next();
                if (function.isExternal()) continue;
                attempted++;
                JsonObject row = new JsonObject();
                row.addProperty("name", function.getName());
                row.addProperty("address", function.getEntryPoint().toString());
                DecompileResults result = decompiler.decompileFunction(function, 20, monitor);
                boolean ok = result.decompileCompleted() && result.getDecompiledFunction() != null;
                row.addProperty("decompiled", ok);
                if (ok) {
                    String code = result.getDecompiledFunction().getC();
                    if (code.length() > 1024 * 1024 || exportedChars + code.length() > 48L * 1024 * 1024) { sizeLimit = true; break; }
                    row.addProperty("pseudocode", code);
                    boolean warnings = code.contains("WARNING:") || code.contains("halt_baddata");
                    row.addProperty("hasWarnings", warnings);
                    if (warnings) warningFunctions++;
                    c.write("/* address: " + function.getEntryPoint() + " */\n" + code + "\n");
                    exportedChars += code.length(); passed++;
                } else { row.addProperty("error", result.getErrorMessage()); failed++; }
                functions.add(row);
                InstructionIterator instructions = currentProgram.getListing().getInstructions(function.getBody(), true);
                int instructionCount = 0;
                assembly.write("\n; " + function.getName() + " @ " + function.getEntryPoint() + "\n");
                while (instructions.hasNext() && instructionCount++ < 50000) {
                    Instruction instruction = instructions.next();
                    assembly.write(instruction.getAddress() + "  " + instruction.toString() + "\n");
                }
                println("PORT_RE_FUNCTION " + attempted + "/" + Math.min(discovered, limit) + " " + function.getName() + " " + (ok ? "decompiled" : "failed"));
            }
        } finally { decompiler.dispose(); }
        JsonObject summary = new JsonObject();
        summary.addProperty("program", currentProgram.getName());
        summary.addProperty("language", currentProgram.getLanguageID().toString());
        summary.addProperty("discovered", discovered);
        summary.addProperty("attempted", attempted);
        summary.addProperty("decompiled", passed);
        summary.addProperty("failed", failed);
        summary.addProperty("warningFunctions", warningFunctions);
        summary.addProperty("limited", discovered > functions.size() || sizeLimit || monitor.isCancelled());
        summary.addProperty("originalSourceRecovered", false);
        summary.addProperty("note", "Functions discovered by this auto-analysis, not all original source. Assembly export is limited to 50000 instructions per function.");
        Gson gson = new GsonBuilder().setPrettyPrinting().create();
        Files.writeString(output.resolve("functions.json"), gson.toJson(functions), StandardCharsets.UTF_8);
        Files.writeString(output.resolve("summary.json"), gson.toJson(summary), StandardCharsets.UTF_8);
        println("PORT_RE_EXPORT_COMPLETE " + passed + " decompiled; " + failed + " failed");
    }
}
