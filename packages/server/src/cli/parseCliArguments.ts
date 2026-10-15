/** What the command line asked for. */
export interface CliArguments {
    configPath?: string;
    help: boolean;

    /** Set when the arguments could not be understood. */
    problem?: string;
}

/** Reads `--config <file>` and `--help` from the arguments after the program name. */
export function parseCliArguments(args: string[]): CliArguments {
    const result: CliArguments = { help: false };

    for (let index = 0; index < args.length; index++) {
        const argument = args[index];

        if (argument === "--help" || argument === "-h") {
            result.help = true;
        } else if (argument === "--config" || argument === "-c") {
            const value = args[++index];

            if (!value) {
                return { ...result, problem: `${argument} needs a file name.` };
            }

            result.configPath = value;
        } else if (argument.startsWith("--config=")) {
            result.configPath = argument.slice("--config=".length);
        } else {
            return { ...result, problem: `Unknown argument "${argument}".` };
        }
    }

    return result;
}
