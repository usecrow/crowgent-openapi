#!/usr/bin/env node
import { program } from 'commander';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname, relative } from 'path';
import OpenAI from 'openai';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import ora from 'ora';

const EXTENSIONS = ['.ts', '.js', '.tsx', '.jsx', '.py', '.rb', '.go', '.java', '.kt', '.rs'];
const IGNORE = ['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', 'coverage'];

program
  .name('crowgent-openapi')
  .description('Generate OpenAPI specs from your backend code using AI')
  .argument('[directory]', 'Backend directory to scan')
  .option('-o, --output <file>', 'Output file')
  .option('-k, --api-key <key>', 'OpenAI API key (or set OPENAI_API_KEY)')
  .option('-m, --model <model>', 'Model to use', 'gpt-4o-mini')
  .option('--base-url <url>', 'API base URL')
  .option('--yes', 'Skip prompts and use defaults', false)
  .action(async (directory, opts) => {
    // Welcome
    console.log();
    p.intro(chalk.bgCyan.black(' 🐦 Crowgent OpenAPI Generator '));

    const apiKey = opts.apiKey || process.env.OPENAI_API_KEY;
    
    // Check API key
    if (!apiKey) {
      p.log.error('Missing OpenAI API key');
      p.log.info('Set OPENAI_API_KEY environment variable or use --api-key flag');
      p.outro(chalk.red('Setup incomplete'));
      process.exit(1);
    }

    // Ask for consent
    if (!opts.yes) {
      const consent = await p.confirm({
        message: 'This will send your code to OpenAI to generate an API spec. Continue?',
        initialValue: true,
      });

      if (p.isCancel(consent) || !consent) {
        p.outro(chalk.yellow('Cancelled'));
        process.exit(0);
      }
    }

    // Get directory
    let targetDir = directory;
    if (!targetDir && !opts.yes) {
      const dirInput = await p.text({
        message: 'Which directory contains your backend code?',
        placeholder: './src or ./routes',
        defaultValue: '.',
        validate: (value) => {
          if (!existsSync(value)) return 'Directory not found';
        },
      });
      
      if (p.isCancel(dirInput)) {
        p.outro(chalk.yellow('Cancelled'));
        process.exit(0);
      }
      targetDir = dirInput as string;
    }
    targetDir = targetDir || '.';

    // Validate directory
    if (!existsSync(targetDir)) {
      p.log.error(`Directory not found: ${targetDir}`);
      p.outro(chalk.red('Failed'));
      process.exit(1);
    }

    // Get output file
    let outputFile = opts.output;
    if (!outputFile && !opts.yes) {
      const outputInput = await p.text({
        message: 'Where should we save the OpenAPI spec?',
        placeholder: 'openapi.yaml',
        defaultValue: 'openapi.yaml',
      });
      
      if (p.isCancel(outputInput)) {
        p.outro(chalk.yellow('Cancelled'));
        process.exit(0);
      }
      outputFile = outputInput as string;
    }
    outputFile = outputFile || 'openapi.yaml';

    // Get base URL
    let baseUrl = opts.baseUrl;
    if (!baseUrl && !opts.yes) {
      const urlInput = await p.text({
        message: 'What is your API base URL?',
        placeholder: 'http://localhost:3000',
        defaultValue: 'http://localhost:3000',
      });
      
      if (p.isCancel(urlInput)) {
        p.outro(chalk.yellow('Cancelled'));
        process.exit(0);
      }
      baseUrl = urlInput as string;
    }
    baseUrl = baseUrl || 'http://localhost:3000';

    // Scan files
    const scanSpinner = ora('Scanning files...').start();
    const files = collectFiles(targetDir);
    scanSpinner.succeed(`Found ${files.length} source files`);

    if (files.length === 0) {
      p.log.error('No source files found');
      p.outro(chalk.red('Failed'));
      process.exit(1);
    }

    // Generate spec
    const genSpinner = ora('Generating OpenAPI spec with AI...').start();
    
    try {
      const openai = new OpenAI({ apiKey });
      
      const codeContext = files
        .map(f => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
        .join('\n\n');

      const response = await openai.chat.completions.create({
        model: opts.model,
        messages: [{
          role: 'system',
          content: `You are an expert at generating OpenAPI 3.0 specifications. 
Analyze the provided backend code and generate a complete, valid OpenAPI 3.0.3 YAML spec.
Include: all endpoints, HTTP methods, path/query parameters, request bodies, response schemas with properties.
Use descriptive summaries. Infer types from the code. Return ONLY valid YAML, no markdown or explanation.`
        }, {
          role: 'user',
          content: `Generate an OpenAPI spec for this backend code. Base URL: ${baseUrl}\n\n${codeContext}`
        }],
        max_tokens: 16000,
        temperature: 0.2,
      });

      let yaml = response.choices[0].message.content || '';
      yaml = yaml.replace(/^```ya?ml\n?/i, '').replace(/\n?```$/i, '').trim();

      writeFileSync(outputFile, yaml);
      
      const tokens = response.usage?.total_tokens || 0;
      const cost = (tokens * 0.00015 / 1000).toFixed(4);
      
      genSpinner.succeed('OpenAPI spec generated');
      
      p.log.success(`Saved to ${chalk.cyan(outputFile)}`);
      p.log.info(`${tokens} tokens used (~$${cost})`);
      
      p.outro(chalk.green('✨ Done!'));
      
    } catch (error: any) {
      genSpinner.fail('Generation failed');
      p.log.error(error.message || 'Unknown error');
      p.outro(chalk.red('Failed'));
      process.exit(1);
    }
  });

function collectFiles(dir: string, root = dir): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];

  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || IGNORE.includes(entry)) continue;

    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...collectFiles(fullPath, root));
    } else if (EXTENSIONS.includes(extname(entry)) && stat.size < 100_000) {
      files.push({
        path: relative(root, fullPath),
        content: readFileSync(fullPath, 'utf-8'),
      });
    }
  }
  return files;
}

program.parse();
