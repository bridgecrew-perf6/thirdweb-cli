import { THIRDWEB_URL, cliVersion } from "../constants/urls";
import build from "../core/builder/build";
import detect from "../core/detection/detect";
import { execute } from "../core/helpers/exec";
import { error, info, logger, spinner, warn } from "../core/helpers/logger";
import { ContractPayload } from "../core/interfaces/ContractPayload";
import { IpfsStorage } from "../core/storage/ipfs-storage";
import chalk from "chalk";
import { readFileSync } from "fs";
import path from "path";
import { createContractsPrompt } from "../core/helpers/selector";

export async function processProject(
  options: any,
  command: "deploy" | "publish",
) {
  // TODO: allow overriding the default storage
  const storage = new IpfsStorage();

  logger.setSettings({
    minLevel: options.debug ? "debug" : "info",
  });

  let projectPath = process.cwd();
  if (options.path) {
    logger.debug("Overriding project path to " + options.path);

    const resolvedPath = (options.path as string).startsWith("/")
      ? options.path
      : path.resolve(`${projectPath}/${options.path}`);
    projectPath = resolvedPath;
  }

  logger.debug("Processing project at path " + projectPath);

  const projectType = await detect(projectPath, options);

  if (options.ci) {
    logger.info("Installing dependencies...");
    try {
      switch (projectType) {
        case "foundry": {
          await execute(`npm install`, projectPath);
          await execute(`forge install`, projectPath);
          break;
        }
        default: {
          await execute(`npm install`, projectPath);
          break;
        }
      }
    } catch (e) {
      logger.warn("Could not install dependencies", e);
    }
  }

  let compiledResult;
  const compileLoader = spinner("Compiling project...");
  try {
    compiledResult = await build(projectPath, projectType);
  } catch (e) {
    compileLoader.fail("Compilation failed");
    logger.error(e);
    process.exit(1);
  }
  compileLoader.succeed("Compilation successful");

  if (compiledResult.contracts.length == 0) {
    logger.error(
      "No deployable contract detected. Run with the '--debug' option to see what contracts were skipped and why.",
    );
    process.exit(1);
  }

  let selectedContracts: ContractPayload[] = [];
  if (compiledResult.contracts.length == 1) {
    selectedContracts = [compiledResult.contracts[0]];
    info(
      `Processing contract: ${chalk.blueBright(
        selectedContracts.map((c) => `"${c.name}"`).join(", "),
      )}`,
    );
  } else {
    if (options.ci) {
      selectedContracts = compiledResult.contracts;
    } else {
      const choices = compiledResult.contracts.map((c) => ({
        name: c.name,
        value: c,
      }));
      const prompt = createContractsPrompt(choices, "Choose which contract(s) to deploy");
      const selection: Record<string, ContractPayload> = await prompt.run();
      selectedContracts = Object.keys(selection).map((key) => selection[key]);
    }
  }

  if (selectedContracts.length === 0) {
    error(
      "No contract selected. Please select at least one contract to deploy.",
    );
    process.exit(1);
  }

  if (options.dryRun) {
    info("Dry run, skipping deployment");
    process.exit(0);
  }

  const loader = spinner("Uploading contract data...");
  try {
    for (let i = 0; i < selectedContracts.length; i++) {
      const contract = selectedContracts[i];
      if (contract.sources) {
        // upload sources in batches to avoid getting rate limited (needs to be single uploads)
        const batchSize = 3;
        for (let j = 0; j < contract.sources.length; j = j + batchSize) {
          const batch = contract.sources.slice(j, j + batchSize);
          logger.debug(`Uploading Sources:\n${batch.join("\n")}\n`);
          await Promise.all(
            batch.map(async (c) => {
              const file = readFileSync(c, "utf-8");
              return await storage.uploadSingle(file);
            }),
          );
        }
      }
    }

    // Upload build output metadatas (need to be single uploads)
    const metadataURIs = await Promise.all(
      selectedContracts.map(async (c) => {
        logger.debug(`Uploading ${c.name}...`);
        const hash = await storage.uploadSingle(c.metadata);
        return `ipfs://${hash}`;
      }),
    );

    // Upload batch all bytecodes
    const bytecodes = selectedContracts.map((c) => c.bytecode);
    const { metadataUris: bytecodeURIs } = await storage.uploadBatch(bytecodes);

    const combinedContents = selectedContracts.map((c, i) => {
      return {
        name: c.name,
        metadataUri: metadataURIs[i],
        bytecodeUri: bytecodeURIs[i],
      };
    });
    const { metadataUris: combinedURIs } = await storage.uploadMetadataBatch(
      combinedContents,
    );
    loader.succeed("Upload successful");

    return getUrl(combinedURIs, command, projectType, options);
  } catch (e) {
    loader.fail("Error uploading metadata");
    throw e;
  }
}

export function getUrl(
  hashes: string[],
  command: string,
  projectType: string,
  options: any,
) {
  let url;
  if (hashes.length == 1 && command === "deploy") {
    url = new URL(
      THIRDWEB_URL +
        "/contracts/" +
        encodeURIComponent(hashes[0].replace("ipfs://", "")),
    );
  } else {
    url = new URL(THIRDWEB_URL + "/contracts/" + command);
    for (let hash of hashes) {
      url.searchParams.append("ipfs", hash.replace("ipfs://", ""));
    }
  }
  url.searchParams.append("utm_source", "thirdweb-cli");
  url.searchParams.append("utm_campaign", cliVersion);
  url.searchParams.append("utm_medium", projectType);
  if (options.ci) {
    url.searchParams.append("utm_content", "ci");
  }
  return url;
}

