#!/usr/bin/env node
import { program } from 'commander';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname, relative, resolve } from 'path';
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
    console.log();
    p.intro(chalk.bgCyan.black(' 🐦 Crowgent OpenAPI Generator '));

    // Friendly explanation
    p.note(
      `I'll generate an OpenAPI spec from your backend code.\n\n` +
      `${chalk.dim('What happens next?')}\n` +
      `Upload the spec to Crow and your API endpoints become\n` +
      `actions that your AI agent can call on behalf of users.`,
      'Welcome'
    );

    const apiKey = opts.apiKey || process.env.OPENAI_API_KEY;
    
    // Check API key
    if (!apiKey) {
      p.log.error('Missing OpenAI API key');
      p.log.message(
        `${chalk.dim('To fix this, run:')}\n` +
        `${chalk.cyan('export OPENAI_API_KEY="sk-..."')}\n\n` +
        `${chalk.dim('Get your key at:')} ${chalk.underline('https://platform.openai.com/api-keys')}`
      );
      p.outro(chalk.red('Setup incomplete'));
      process.exit(1);
    }

    // Ask for consent with explanation
    if (!opts.yes) {
      const consent = await p.confirm({
        message: `I'll scan your code and send it to OpenAI to generate the spec. This typically costs < $0.01. Continue?`,
        initialValue: true,
      });

      if (p.isCancel(consent) || !consent) {
        p.outro(chalk.yellow('No problem! Run me again when you\'re ready.'));
        process.exit(0);
      }
    }

    // Get directory with helpful guidance
    let targetDir = directory;
    
    // If they provided a path that doesn't exist, warn and ask again
    if (targetDir && !existsSync(targetDir) && !opts.yes) {
      p.log.warn(`Can't find "${targetDir}"`);
      targetDir = null; // Clear it so we ask interactively
    }
    
    if (!targetDir && !opts.yes) {
      p.log.message(chalk.dim('Tip: Point me at the folder containing your API routes (e.g., ./src, ./routes, ./api)'));
      
      const dirInput = await p.text({
        message: 'Where is your backend code?',
        placeholder: './backend or ./src/api',
        defaultValue: '.',
        validate: (value) => {
          if (!existsSync(value)) return `Can't find "${value}" - check the path and try again`;
        },
      });
      
      if (p.isCancel(dirInput)) {
        p.outro(chalk.yellow('Cancelled'));
        process.exit(0);
      }
      targetDir = dirInput as string;
    }
    targetDir = targetDir || '.';

    // Final validation (for --yes mode)
    if (!existsSync(targetDir)) {
      p.log.error(`Can't find "${targetDir}"`);
      p.log.message(chalk.dim('Make sure the path exists and try again.'));
      p.outro(chalk.red('Failed'));
      process.exit(1);
    }

    // Handle single file vs directory
    const targetPath = resolve(targetDir);
    const stat = statSync(targetPath);
    
    if (!stat.isDirectory()) {
      // It's a file - use its parent directory but only include this file
      p.log.warn(`"${targetDir}" is a file, not a directory. I'll analyze just this file.`);
    }

    // Get output file
    let outputFile = opts.output;
    if (!outputFile && !opts.yes) {
      const outputInput = await p.text({
        message: 'Where should I save the OpenAPI spec?',
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
    const outputPath = resolve(outputFile);

    // Get base URL with explanation
    let baseUrl = opts.baseUrl;
    if (!baseUrl && !opts.yes) {
      p.log.message(chalk.dim('This is the URL where your API is hosted (used in the spec\'s "servers" field)'));
      
      const urlInput = await p.text({
        message: 'What\'s your API base URL?',
        placeholder: 'https://api.yourapp.com or http://localhost:3000',
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
    p.log.step('Scanning your code...');
    const files = stat.isDirectory() 
      ? collectFiles(targetDir)
      : [{
          path: targetDir,
          content: readFileSync(targetDir, 'utf-8'),
        }];
    
    if (files.length === 0) {
      p.log.error('No source files found');
      p.log.message(
        chalk.dim(`I look for these file types: ${EXTENSIONS.join(', ')}\n`) +
        chalk.dim(`Make sure your backend code is in "${targetDir}"`)
      );
      p.outro(chalk.red('Failed'));
      process.exit(1);
    }

    p.log.success(`Found ${files.length} source file${files.length > 1 ? 's' : ''}`);
    
    // Show which files we found
    if (files.length <= 5) {
      files.forEach(f => p.log.message(chalk.dim(`  • ${f.path}`)));
    } else {
      files.slice(0, 3).forEach(f => p.log.message(chalk.dim(`  • ${f.path}`)));
      p.log.message(chalk.dim(`  • ... and ${files.length - 3} more`));
    }

    // Generate spec
    const genSpinner = ora('Analyzing code and generating OpenAPI spec...').start();
    
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
      
      genSpinner.succeed('OpenAPI spec generated!');
      
      // Success summary
      console.log();
      p.note(
        `${chalk.green('✓')} Saved to: ${chalk.cyan(outputPath)}\n` +
        `${chalk.green('✓')} Tokens used: ${tokens} (~$${cost})\n\n` +
        `${chalk.bold('Next steps:')}\n` +
        `1. Upload this file to ${chalk.cyan('https://app.usecrow.ai/integration/openapi')}\n` +
        `2. Your endpoints will appear as actions at ${chalk.cyan('https://app.usecrow.ai/actions')}\n` +
        `3. Enable the actions you want your AI agent to use`,
        'Done!'
      );
      
      // Q&A feature
      if (!opts.yes) {
        const wantHelp = await p.confirm({
          message: 'Have any questions about OpenAPI or Crow?',
          initialValue: false,
        });

        if (wantHelp && !p.isCancel(wantHelp)) {
          console.log();
          p.log.message(chalk.dim('Ask me anything! Type "done" or press Ctrl+C to exit.\n'));
          
          await runQA(openai, opts.model);
        }
      }
      
      p.outro(chalk.green('Happy building! 🚀'));
      
    } catch (error: any) {
      genSpinner.fail('Generation failed');
      
      if (error.message?.includes('401')) {
        p.log.error('Invalid API key');
        p.log.message(chalk.dim('Check that your OPENAI_API_KEY is correct and has credits.'));
      } else if (error.message?.includes('429')) {
        p.log.error('Rate limited - too many requests');
        p.log.message(chalk.dim('Wait a minute and try again.'));
      } else {
        p.log.error(error.message || 'Unknown error');
      }
      
      p.outro(chalk.red('Failed'));
      process.exit(1);
    }
  });

async function runQA(openai: OpenAI, model: string) {
  const systemPrompt = `You are a helpful assistant for Crow (https://usecrow.ai), an AI agent platform.

You help developers understand:
- OpenAPI specifications: what they are, how they describe REST APIs
- Crow's workflow: generate spec → upload to app.usecrow.ai/integration/openapi → endpoints become "actions"
- Actions: tools that the AI agent can call on behalf of users to interact with their API
- How Crow uses the OpenAPI spec to know what parameters to pass, what responses to expect

Be concise, friendly, and helpful. Keep answers to 2-3 sentences unless they ask for more detail.
If they ask something unrelated to Crow or OpenAPI, politely redirect them.`;

  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: systemPrompt }
  ];

  while (true) {
    const question = await p.text({
      message: chalk.cyan('You:'),
      placeholder: 'What are actions in Crow?',
    });

    if (p.isCancel(question) || !question || question.toLowerCase() === 'done') {
      p.log.message(chalk.dim('\nGoodbye! 👋'));
      break;
    }

    messages.push({ role: 'user', content: question as string });

    const spinner = ora('Thinking...').start();
    
    try {
      const response = await openai.chat.completions.create({
        model,
        messages,
        max_tokens: 300,
        temperature: 0.7,
      });

      const answer = response.choices[0].message.content || 'Sorry, I couldn\'t generate a response.';
      messages.push({ role: 'assistant', content: answer });
      
      spinner.stop();
      console.log();
      p.log.message(`${chalk.green('Crow:')} ${answer}`);
      console.log();
    } catch (error: any) {
      spinner.fail('Failed to get response');
      p.log.error(chalk.dim(error.message || 'Unknown error'));
    }
  }
}

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
