#!/usr/bin/env node_modules/.bin/ts-node

import tar from 'tar';
import asyncfile from 'async-file';
import md5 from 'md5';
import { resolve, join, relative, dirname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import commandLineArgs from 'command-line-args';
import commandLineUsage from 'command-line-usage';
import { Readable } from 'stream';
import readdir from 'recursive-readdir';
import os from 'os';
import yaml from 'js-yaml';
import tmp from 'tmp';
import fs from 'fs';
import path from 'path';
import uniqBy from 'lodash.uniqby';

interface IEntry {
    isDirectory: boolean;
    name: string;
}

class TreeWalker {
    async package(sourcePath: string) {
        return readdir(sourcePath, [
            (file: string, stats: asyncfile.Stats) =>
                !relative(sourcePath, file).startsWith('Assets') || file.endsWith('.pdb') || file.endsWith('.meta'),
        ]).then(f => {
            const outputDirs = new Set<string>();
            return new Promise<string>((resolve, reject) =>
                tmp.dir({ unsafeCleanup: true }, (err, path, _) => resolve(path))
            )
                .then(async tmp => {
                    const dirs = new Set<string>();
                    for (const file of f) {
                        const rel = relative(sourcePath, file);
                        const metafile = file + '.meta';
                        if (!(await asyncfile.exists(metafile))) {
                            continue;
                        }
                        const meta = await asyncfile.readTextFile(metafile);
                        const yamlmeta: { guid: string } = yaml.safeLoad(meta, { json: true });
                        const targetdir = join(tmp, yamlmeta.guid);
                        const targetasset = join(targetdir, 'asset');
                        const targetmeta = join(targetdir, 'asset.meta');
                        const targetname = join(targetdir, 'pathname');
                        const targetpreview = join(targetdir, 'preview.png');
                        await asyncfile.mkdir(targetdir);
                        await asyncfile.writeTextFile(targetname, rel);
                        fs.copyFileSync(file, targetasset);
                        fs.copyFileSync(metafile, targetmeta);
                        if (path.extname(file) === '.png') {
                            fs.copyFileSync(join(sourcePath, 'preview.png'), targetpreview);
                        }

                        const dir = path.dirname(file);
                        if (!dirs.has(dir)) {
                            dirs.add(dir);
                        }
                        if (!outputDirs.has(targetdir)) {
                            outputDirs.add(targetdir);
                        }
                    }

                    for (const dir of dirs.keys()) {
                        const rel = relative(sourcePath, dir);
                        const metafile = dir + '.meta';
                        if (!(await asyncfile.exists(metafile))) {
                            continue;
                        }

                        const meta = await asyncfile.readTextFile(metafile);
                        const yamlmeta: { guid: string } = yaml.safeLoad(meta, { json: true });
                        const targetdir = join(tmp, yamlmeta.guid);
                        const targetmeta = join(targetdir, 'asset.meta');
                        const targetname = join(targetdir, 'pathname');
                        await asyncfile.mkdir(targetdir);
                        fs.copyFileSync(metafile, targetmeta);
                        await asyncfile.writeTextFile(targetname, rel.replace(/\\/g, "/"));
                        const dirname = path.dirname(targetname);
                        if (!outputDirs.has(dirname)) {
                            outputDirs.add(dirname);
                        }
                    }
                    return tmp;
                })
                .then(tmp => {
                    return readdir(tmp)
                        .then(list => {
                            const entries = new Set<string>();
                            for (var entry of list) {
                                const path = relative(tmp, entry);
                                const dirn = dirname(path);
                                if (!entries.has(dirn))
                                    entries.add(dirn);
                                entries.add(path);
                            }
                            return Array.from(entries).sort();
                        })
                        .then(list => {
                            return tar.create(
                                {
                                    gzip: true,
                                    cwd: tmp,
                                    noDirRecurse: true,
                                },
                                list
                            );
                        });
                });
        });
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

if (!options.path || !asyncfile.exists(options.path) || !options.file || !options.out) {
    console.error(commandLineUsage(sections));
    process.exit(-1);
}

const sourcePath: string = resolve(options.path);
const targetZipPath: string = join(options.out, `${options.file}.unitypackage`);
const targetMd5Path: string = join(options.out, `${options.file}.unitypackage.md5`);

(async () => {
    const walker = new TreeWalker();

    let zip = await walker.package(sourcePath);

    asyncfile.mkdirp(path.dirname(targetZipPath)).then(() => {
        zip.pipe(asyncfile.createWriteStream(targetZipPath)).on('finish', async () => {
            const hash = md5(await asyncfile.readFile(targetZipPath));
            await asyncfile.writeTextFile(targetMd5Path, hash);
            console.log(`${targetZipPath} and ${targetMd5Path} created`);
        });
    });
})();
