// Port RE: reconstructed pseudocode and assembly, never original source.
//@category PortRE
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.listing.*;
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
        int limit = args.length > 1 ? Integer.parseInt(args[1]) : 0;
        if (limit < 0 || limit > 10000) throw new IllegalArgumentException("Function limit out of range (0 = all discovered)");
        int discovered = 0;
        FunctionIterator count = currentProgram.getFunctionManager().getFunctions(true);
        while (count.hasNext()) { monitor.checkCancelled(); if (!count.next().isExternal()) discovered++; }
        Gson gson = new GsonBuilder().setPrettyPrinting().create();
        Gson compact = new Gson();
        JsonArray functions = new JsonArray();
        DecompInterface decompiler = new DecompInterface();
        if (!decompiler.openProgram(currentProgram)) throw new IOException("Decompiler could not open the program: " + decompiler.getLastMessage());
        int attempted = 0, passed = 0, failed = 0, warningFunctions = 0;
        long exportedChars = 0, jsonChars = 0;
        boolean sizeLimit = false;
        try (BufferedWriter c = Files.newBufferedWriter(output.resolve("pseudocode.c"), StandardCharsets.UTF_8);
             BufferedWriter index = Files.newBufferedWriter(output.resolve("functions-index.jsonl"), StandardCharsets.UTF_8)) {
            c.write("/* Port RE / Ghidra: reconstructed pseudocode.\n * Not the complete original source; not guaranteed to compile.\n * Missing names, types, logic and unsupported instructions require manual analysis.\n */\n\n");
            FunctionIterator iterator = currentProgram.getFunctionManager().getFunctions(true);
            while (iterator.hasNext()) {
                monitor.checkCancelled();
                Function function = iterator.next();
                if (function.isExternal()) continue;
                JsonObject row = new JsonObject();
                row.addProperty("name", function.getName());
                row.addProperty("address", function.getEntryPoint().toString());
                row.addProperty("bodyBytes", function.getBody().getNumAddresses());
                if (sizeLimit || (limit > 0 && attempted >= limit)) {
                    row.addProperty("status", sizeLimit ? "not-attempted-size-limit" : "not-attempted-function-limit");
                    index.write(compact.toJson(row) + "\n");
                    continue;
                }
                attempted++;
                DecompileResults result = decompiler.decompileFunction(function, 20, monitor);
                boolean ok = result.decompileCompleted() && result.getDecompiledFunction() != null;
                String code = ok ? result.getDecompiledFunction().getC() : "";
                String error = result.getErrorMessage();
                if (code.length() > 1024 * 1024 || exportedChars + code.length() > 48L * 1024 * 1024) {
                    ok = false; sizeLimit = true; error = "Pseudocode size limit reached";
                }
                // Leave ample space for escaping/pretty printing in functions.json (UI max 64 MiB).
                if (jsonChars + code.length() * 6L + compact.toJson(row).length() * 6L + 8192 > 60L * 1024 * 1024) {
                    sizeLimit = true;
                    row.addProperty("status", "attempted-output-limit");
                    index.write(compact.toJson(row) + "\n"); failed++;
                    continue;
                }
                row.addProperty("decompiled", ok);
                row.addProperty("status", ok ? "decompiled" : "failed");
                if (ok) {
                    row.addProperty("pseudocode", code);
                    boolean warnings = code.contains("WARNING:") || code.contains("halt_baddata");
                    row.addProperty("hasWarnings", warnings);
                    if (warnings) warningFunctions++;
                    c.write("/* address: " + function.getEntryPoint() + " */\n" + code + "\n");
                    exportedChars += code.length(); passed++;
                } else { row.addProperty("error", error == null ? "No pseudocode returned" : error.substring(0, Math.min(error.length(), 4000))); failed++; }
                jsonChars += compact.toJson(row).length() + 512;
                functions.add(row);
                JsonObject indexed = row.deepCopy(); indexed.remove("pseudocode");
                index.write(compact.toJson(indexed) + "\n");
                println("PORT_RE_FUNCTION " + attempted + "/" + (limit == 0 ? discovered : Math.min(discovered, limit)) + " " + function.getName() + " " + (ok ? "decompiled" : "failed"));
            }
        } finally { decompiler.dispose(); }
        // Include defined instructions outside recognized functions too. Binary copies retain undecoded bytes.
        long instructionTotal = currentProgram.getListing().getNumInstructions(), instructionsExported = 0, assemblyChars = 0;
        boolean assemblyLimited = false;
        try (BufferedWriter assembly = Files.newBufferedWriter(output.resolve("disassembly.txt"), StandardCharsets.UTF_8)) {
            assembly.write("; All instructions defined by this Ghidra analysis, including outside recognized functions.\n; Undecoded bytes remain in the original executable; this is not all original game code.\n");
            InstructionIterator instructions = currentProgram.getListing().getInstructions(true);
            while (instructions.hasNext()) {
                monitor.checkCancelled();
                Instruction instruction = instructions.next();
                String line = instruction.getAddress() + "  " + instruction.toString() + "\n";
                if (assemblyChars + line.length() > 96L * 1024 * 1024) { assemblyLimited = true; break; }
                assembly.write(line); assemblyChars += line.length(); instructionsExported++;
            }
        }
        JsonObject summary = new JsonObject();
        summary.addProperty("program", currentProgram.getName());
        summary.addProperty("language", currentProgram.getLanguageID().toString());
        summary.addProperty("discovered", discovered);
        summary.addProperty("attempted", attempted);
        summary.addProperty("decompiled", passed);
        summary.addProperty("failed", failed);
        summary.addProperty("warningFunctions", warningFunctions);
        summary.addProperty("requestedLimit", limit);
        summary.addProperty("notAttempted", discovered - attempted);
        summary.addProperty("sizeLimited", sizeLimit);
        summary.addProperty("limited", discovered > attempted || sizeLimit || assemblyLimited);
        summary.addProperty("definedInstructions", instructionTotal);
        summary.addProperty("exportedInstructions", instructionsExported);
        summary.addProperty("assemblyLimited", assemblyLimited);
        summary.addProperty("originalSourceRecovered", false);
        summary.addProperty("note", "Functions and instructions discovered by this auto-analysis, not all original source. 0 = all discovered functions attempted, subject to time/size limits. Full discovered function index: functions-index.jsonl.");
        Files.writeString(output.resolve("functions.json"), gson.toJson(functions), StandardCharsets.UTF_8);
        Files.writeString(output.resolve("summary.json"), gson.toJson(summary), StandardCharsets.UTF_8);
        println("PORT_RE_EXPORT_COMPLETE " + passed + " decompiled; " + failed + " failed");
    }
}
