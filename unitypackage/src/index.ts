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
    zip(date: Date, path: string, basePath: string): Promise<JSZip> {
        let zip = new JSZip();
        if (basePath !== '') {
            zip.file(basePath, '', {
                dir: true,
                date: date,
            });
        }
        return this.runzip(zip, date, path, basePath);
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
        description: 'Path to the source assets to be packaged',
    },
    {
        name: 'file',
        typeLabel: '{underline file}',
        description: 'Filename of the unitypackage',
    },
    {
        name: 'out',
        typeLabel: '{underline directory}',
        description: 'Where to save the zip and md5 files',
    },
];

const sections = [
    {
        header: 'Unity packager',
        content: 'Creates a .unitypackage',
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

const sourcePath: string = resolve(options.path);
const targetZipPath: string = join(options.out, options.file, '.unitypackage');
const targetMd5Path: string = join(options.out, options.file, '.unitypackage.md5');

(async () => {
    const walker = new TreeWalker();

    const output = await promisify(exec)('git log -n1 --format=%cI .', { cwd: sourcePath });
    const date = new Date(output.stdout.trim());

    let zip = await walker.zip(date, sourcePath, '');

    zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true })
    .pipe(fs.createWriteStream(targetZipPath))
    .on('finish', async () => {
        const hash = md5(await fs.readFile(targetZipPath));
        await fs.writeTextFile(targetMd5Path, hash);
        console.log(`${targetZipPath} and ${targetMd5Path} created`);
    });    
})();