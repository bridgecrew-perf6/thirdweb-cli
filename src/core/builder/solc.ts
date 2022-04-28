import { logger } from "../helpers/logger";
import { CompileOptions } from "../interfaces/Builder";
import { ContractPayload } from "../interfaces/ContractPayload";
import { BaseBuilder } from "./builder-base";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  writeFileSync,
} from "fs";
import { basename, join } from "path";
import solc from "solc";

export class SolcBuilder extends BaseBuilder {
  public async compile(options: CompileOptions): Promise<{
    contracts: ContractPayload[];
  }> {
    // find solidity files...
    const inputPaths: string[] = [];
    this.findFiles(options.projectPath, /^.*\.sol$/, inputPaths);

    const sources = inputPaths.reduce((acc, curr) => {
      const source = readFileSync(curr, "utf-8");
      acc[basename(curr, ".sol")] = { content: source };
      return acc;
    }, {} as Record<string, { content: string }>);

    const input = {
      language: "Solidity",
      sources,
      settings: {
        outputSelection: {
          "*": {
            "*": ["*"],
          },
        },
      },
    };

    const output = JSON.parse(
      solc.compile(JSON.stringify(input), {
        import: (path: string) => {
          const nodeModulesPath = join(
            options.projectPath,
            "node_modules",
            path,
          );
          if (existsSync(nodeModulesPath)) {
            return { contents: readFileSync(nodeModulesPath, "utf-8") };
          }
          return {
            error: "file not fount",
          };
        },
      }),
    );

    if (output.errors) {
      logger.error(output.errors);
      process.exit(1);
    }

    const artifactsDir = join(options.projectPath, "artifacts");

    if (options.clean) {
      logger.info("Cleaning artifacts directory");
      if (existsSync(artifactsDir)) {
        rmdirSync(artifactsDir, { recursive: true });
      }
    }

    if (!existsSync(artifactsDir)) {
      mkdirSync(artifactsDir);
    }

    // write them out to artifacts dir
    // TODO technically we *could* just return them straight here, we have them in memory anywa?
    Object.keys(output.contracts)
      .filter((contractName) => contractName in sources)
      .forEach((contractName) => {
        const contract = output.contracts[contractName];
        const contractPath = join(
          options.projectPath,
          "artifacts",
          contractName,
        );

        if (!existsSync(contractPath)) {
          mkdirSync(contractPath);
        }

        const contractNamesInNamespace = Object.keys(contract);
        for (let c of contractNamesInNamespace) {
          const contractFile = contract[c];
          const contractFilePath = join(contractPath, c + ".json");
          writeFileSync(
            contractFilePath,
            JSON.stringify(contractFile, null, 2),
          );
        }
      });

    const contracts: ContractPayload[] = [];
    const files: string[] = [];
    this.findFiles(artifactsDir, /^.*(?<!dbg)\.json$/, files);

    for (const file of files) {
      logger.debug("Processing:", file.replace(artifactsDir, ""));
      const contractName = basename(file, ".json");
      const contractJsonFile = readFileSync(file, "utf-8");

      const contractInfo = JSON.parse(contractJsonFile);
      const abi = contractInfo.abi;
      const bytecode = contractInfo.evm.bytecode.object;

      for (const input of abi) {
        if (this.isThirdwebContract(input)) {
          if (contracts.find((c) => c.name === contractName)) {
            logger.error(
              `Found multiple contracts with name "${contractName}". Contract names should be unique.`,
            );
            process.exit(1);
          }
          contracts.push({
            abi,
            bytecode,
            name: contractName,
          });
          break;
        }
      }
    }

    return { contracts };
  }
}