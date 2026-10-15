import { describe, expect, it } from "vitest";
import { parseCliArguments } from "../../../src/cli/parseCliArguments";

describe("parseCliArguments", () => {
    it("reads --config with its file", () => {
        expect(parseCliArguments(["--config", "queues.json"])).toEqual({ help: false, configPath: "queues.json" });
    });

    it("reads -c and --config=file", () => {
        expect(parseCliArguments(["-c", "a.json"]).configPath).toBe("a.json");
        expect(parseCliArguments(["--config=b.json"]).configPath).toBe("b.json");
    });

    it("reads --help and -h", () => {
        expect(parseCliArguments(["--help"]).help).toBe(true);
        expect(parseCliArguments(["-h"]).help).toBe(true);
    });

    it("reports a --config with no file", () => {
        expect(parseCliArguments(["--config"]).problem).toMatch(/needs a file name/);
    });

    it("reports an argument it does not know", () => {
        expect(parseCliArguments(["--port", "80"]).problem).toMatch(/Unknown argument "--port"/);
    });

    it("accepts no arguments, leaving the caller to complain that a config is needed", () => {
        expect(parseCliArguments([])).toEqual({ help: false });
    });
});
