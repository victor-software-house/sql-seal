import { Command } from "commander";

const program = new Command();

program
  .name("sqlseal-cli")
  .description("CLI companion for SQLSeal MATERIALIZE feature")
  .version("0.41.0");

program
  .command("materialize")
  .description("Materialize queries in a vault or file")
  .argument("<path>", "Path to vault or file")
  .action((path) => {
      console.log(`Materializing at ${path}`);
      // TODO: implement CLI materialization logic
  });

program
  .command("check")
  .description("Check for stale materializations without writing")
  .argument("<path>", "Path to vault or file")
  .action((path) => {
      console.log(`Checking at ${path}`);
      // TODO: implement check logic
  });

program.parse();
