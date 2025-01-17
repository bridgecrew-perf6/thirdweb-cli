#!/usr/bin/env node
import { installGithubAction } from "../common/ci-installer";
import { processProject } from "../common/processor";
import { twCreate } from "../create/command";
import { cliVersion, pkg } from "../constants/urls";
import { info, logger } from "../core/helpers/logger";
import chalk from "chalk";
import { Command } from "commander";
import open from "open";
import updateNotifier from "update-notifier";
import { detectExtensions } from "../common/feature-detector";


const main = async () => {
  const program = new Command();

  //yes this has to look like this, eliminates whitespace
  console.info(`
  $$\\     $$\\       $$\\                 $$\\                         $$\\       
  $$ |    $$ |      \\__|                $$ |                        $$ |      
$$$$$$\\   $$$$$$$\\  $$\\  $$$$$$\\   $$$$$$$ |$$\\  $$\\  $$\\  $$$$$$\\  $$$$$$$\\  
\\_$$  _|  $$  __$$\\ $$ |$$  __$$\\ $$  __$$ |$$ | $$ | $$ |$$  __$$\\ $$  __$$\\ 
  $$ |    $$ |  $$ |$$ |$$ |  \\__|$$ /  $$ |$$ | $$ | $$ |$$$$$$$$ |$$ |  $$ |
  $$ |$$\\ $$ |  $$ |$$ |$$ |      $$ |  $$ |$$ | $$ | $$ |$$   ____|$$ |  $$ |
  \\$$$$  |$$ |  $$ |$$ |$$ |      \\$$$$$$$ |\\$$$$$\\$$$$  |\\$$$$$$$\\ $$$$$$$  |
   \\____/ \\__|  \\__|\\__|\\__|       \\_______| \\_____\\____/  \\_______|\\_______/ `);
  console.info(`\n 💎 thirdweb-cli v${cliVersion} 💎\n`);
  updateNotifier({
    pkg,
    shouldNotifyInNpmScript: true,
    //check every time while we're still building the CLI
    updateCheckInterval: 0,
  }).notify();

  program
    .name("thirdweb-cli")
    .description("Official thirdweb command line interface")
    .version(cliVersion, "-v, --version", "output the current version");

  program
    .command("detect")
    .description("Compile contracts and detect implemented thirdweb contract extensions")
    .option("-p, --path <project-path>", "path to project", ".")
    .option("-d, --debug", "show debug logs")
    .option("-a, --all", "run detection on all contracts")
    .action(async (options) => {
      await detectExtensions(options);
    })

  program
    .command("publish")
    .description(
      "Compile & publish contracts, makes them available for easy deployment from the dashboard.",
    )
    .option("-p, --path <project-path>", "path to project", ".")
    .option("--dry-run", "dry run (skip actually publishing)")
    .option("-d, --debug", "show debug logs")
    .option("--ci", "Continuous Integration mode")
    .action(async (options) => {
      const url = await processProject(options, "publish");
      info(`Open this link to publish your contracts:`);
      logger.info(chalk.blueBright(url));
      open(url.toString());
    });

  program
    .command("deploy")
    .description(
      "Compile & deploy contracts through your thirdweb dashboard, without dealing with private keys.",
    )
    .option("-p, --path <project-path>", "path to project", ".")
    .option("--dry-run", "dry run (skip actually publishing)")
    .option("-d, --debug", "show debug logs")
    .option("--ci", "Continuous Integration mode")
    .action(async (options) => {
      const url = await processProject(options, "deploy");
      info(`Open this link to deploy your contracts:`);
      logger.info(chalk.blueBright(url));
      open(url.toString());
    });

  program
    .command("create")
    .description(
      "Create a thirdweb app from any of our official templates. Checkout some examples you can use here: https://github.com/thirdweb-example/\"",
    ).option("--app", `Create a thirdweb app.`,)
    .option("--ts, --typescript", `Initialize as a TypeScript project.`)
    .option("--js, --javascript", `Initialize as a JavaScript project.`)
    .option("--cra", `Initialize as a Create React App project.`)
    .option("--next", `Initialize as a Next.js project.`)
    .option("--use-npm", `Explicitly tell the CLI to bootstrap the app using npm`)
    .option("--use-pnpm",`Explicitly tell the CLI to bootstrap the app using pnpm`)
    .option("--framework [name]", `The preferred framework.`)
    .option("-e, --example [name]",`An example to bootstrap the app with. You can use an example repo name from the official thirdweb-example org.`)
    .action(async (options) => {
      await twCreate(options);
    });

  program
    .command("install-ci")
    .description(
      "(alpha) Set up continuous integration for your contracts. This adds a github action to deploy the project on pull requests and pushes to branches. Publishes on push the the main branch.",
    )
    .action(async (options) => {
      await installGithubAction(options);
    });

  await program.parseAsync();
};

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    logger.error(err);
    process.exit(1);
  });
