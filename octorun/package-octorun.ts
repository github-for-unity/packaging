#!/usr/bin/env node_modules/.bin/ts-node

import JSZip from 'jszip';
import * as fs from 'async-file';
import md5 from 'md5';
import { resolve, join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import commandLineArgs from 'command-line-args';
import commandLineUsage from 'command-line-usage';

interface IEntry {
    isDirectory: boolean;
    name: string;
}

class TreeWalker {
    async *walk(path: string, base: string): AsyncIterableIterator<IEntry> {
        const files = await fs.readdir(path);
        for (let i = 0; i < files.length; i++) {
            const fileFromBase: string = join(base, files[i]);
            const file: string = join(path, files[i]);
            const stat = await fs.stat(file);
            if (stat.isDirectory()) {
                yield { isDirectory: true, name: fileFromBase };
                for await (let f of this.walk(file, fileFromBase)) {
                    yield f;
                }
            } else {
                yield { isDirectory: false, name: fileFromBase };
            }
        }
    }

    zip(date: Date, path: string, base: string): Promise<JSZip> {
        let zip = new JSZip();
        if (base !== '') {
            zip.file(base, '', {
                dir: true,
                date: date,
            });
        }
        return this.runzip(zip, date, path, base);
    }

    private runzip(zip: JSZip, date: Date, path: string, base: string): Promise<JSZip> {
        return (async () => {
            const files = await fs.readdir(path);
            for (let i = 0; i < files.length; i++) {
                const filename: string = files[i];
                const fileFromBase: string = join(base, filename);
                const file: string = join(path, filename);
                const stat = await fs.stat(file);
                if (stat.isDirectory()) {
                    zip.file(fileFromBase, '', {
                        dir: true,
                        date: date,
                    });
                    await this.runzip(zip, date, file, fileFromBase);
                } else {
                    zip.file(fileFromBase, fs.readFile(file), {
                        date: date,
                    });
                }
            }
            return zip;
        })();
    }
}

const optionDefinitions = [
    {
        name: 'help',
        alias: 'h',
        description: 'Display this usage guide.',
    },
    {
        name: 'path',
        typeLabel: '{underline directory}',
        description: 'Path to octorun directory',
    },
    {
        name: 'out',
        typeLabel: '{underline directory}',
        description: 'Where to save the zip and md5 files',
    },
];

const sections = [
    {
        header: 'Octorun packager',
        content: 'Generates octorun.zip and octorun.zip.md5',
    },
    {
        header: 'Options',
        optionList: optionDefinitions,
    },
];

const options = commandLineArgs(optionDefinitions);

if (options.path === undefined || !fs.exists(options.path)) {
    console.error(commandLineUsage(sections));
    process.exit(-1);
}

const octorunPath: string = resolve(options.path);
const octorunZipPath: string = join(options.out, 'octorun.zip');
const octorunMd5Path: string = join(options.out, 'octorun.zip.md5');

(async () => {
    const walker = new TreeWalker();

    // for await (let file of walker.walk(resolve('../octorun'), '')) {
    //     console.log(file);
    // }

    const output = await promisify(exec)('git log -n1 --format=%cI .', { cwd: octorunPath });
    const date = new Date(output.stdout.trim());
    let zip = await walker.zip(date, octorunPath, 'octorun');
    zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true })
        .pipe(fs.createWriteStream(octorunZipPath))
        .on('finish', async () => {
            const hash = md5(await fs.readFile(octorunZipPath));
            await fs.writeTextFile(octorunMd5Path, hash);
            console.log(`${octorunZipPath} and ${octorunMd5Path} created`);
        });
})();
