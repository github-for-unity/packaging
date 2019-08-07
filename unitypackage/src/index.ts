#!/usr/bin/env node_modules/.bin/ts-node

import * as tar from 'tar';
import * as asyncfile from 'async-file';
import * as md5 from 'md5';
import * as commandLineArgs from 'command-line-args';
import * as commandLineUsage from 'command-line-usage';
import { Readable } from 'stream';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import { ReplaySubject, defer, pipe, Observable, Observer, TeardownLogic, Subject, generate, of, from } from 'rxjs';
import { toArray, take, pluck, map, filter, first, takeWhile, skipWhile } from 'rxjs/operators';
import * as p from 'path';
import * as sizeOf from "image-size";
import { exec, execSync } from 'child_process';
import { readdir, Ignores, FileEntry } from './RecursiveReaddir';
import { readAllLines, readLines, readLinesFromFile } from './read-lines';
import { copyFile, generateThumbnail, tmpDir } from './helpers';

interface IEntry {
    isDirectory: boolean;
    name: string;
}

class TreeWalker {
	private obs: Observable<FileEntry>;
	private _listener = new ReplaySubject<FileEntry>();
	private running = false;

	public constructor(public path: string, private ignores?: Ignores) {
		this.obs = new Observable((observer: Observer<FileEntry>) => {
			readdir(this.path, ignores || [], (error, file) => {
				if (error) {
					observer.error(error);
				} else if (file) {
					observer.next(file);
				} else {
					observer.complete();
				}
				return false;
			});
		});
	}

	public static walk(path: string, ignores?: Ignores) {
		return new TreeWalker(path, ignores).walk();
	}

	public static copy = (from: string, to: string, ignores?: Ignores) => {
		return new TreeWalker(from, ignores).copy(to);
	}

	private get listener() {
		if (!this.running) {
			this.obs.subscribe(val => { this._listener.next(val); }, err => this._listener.error(err), () => { this._listener.complete() });
			this.running = true;
		}
		return this._listener.asObservable();
	}

	public static getTempDir = () => tmpDir({ prefix: 'unitypackaging-', unsafeCleanup: true });

	private walk = () => {
		return this.listener;
	}

	private copy = (to: string) => {
		const ret = new Subject();

		this.listener.subscribe(async entry => {
			if (entry.isDir) {
				const relativeSourceDir = p.relative(this.path, entry.file);
				const targetDir = p.join(to, relativeSourceDir);
                await asyncfile.mkdirp(targetDir);
                
                const rel = p.relative(sourcePath, entry.file);
                const metafile = entry.file + '.meta';
                if (!(await asyncfile.exists(metafile))) {
                    return;
                }

                const meta = await asyncfile.readTextFile(metafile);
                const yamlmeta: { guid: string } = yaml.safeLoad(meta, { json: true });
                const targetdir = p.join(to, yamlmeta.guid);
                const targetmeta = p.join(targetdir, 'asset.meta');
                const targetname = p.join(targetdir, 'pathname');
                await asyncfile.mkdir(targetdir);
                fs.copyFileSync(metafile, targetmeta);
                await asyncfile.writeTextFile(targetname, rel.replace(/\\/g, '/'));
			} else {
				const relativeSourceDir = p.relative(this.path, p.dirname(entry.file));
                const rel = p.relative(this.path, entry.file);
                const metafile = entry.file + '.meta';
                if (!(await asyncfile.exists(metafile))) {
                    return;
                }
                const meta = await asyncfile.readTextFile(metafile);
                const yamlmeta: { guid: string } = yaml.safeLoad(meta, { json: true });
                const targetdir = p.join(to, yamlmeta.guid);
                const targetasset = p.join(targetdir, 'asset');
                const targetmeta = p.join(targetdir, 'asset.meta');
                const targetname = p.join(targetdir, 'pathname');
                const targetpreview = p.join(targetdir, 'preview.png');
                await asyncfile.mkdir(targetdir);
                await asyncfile.writeTextFile(targetname, rel.replace(/\\/g, '/'));
                fs.copyFileSync(entry.file, targetasset);
                fs.copyFileSync(metafile, targetmeta);
                if (p.extname(entry.file) === '.png') {
                    fs.copyFileSync(p.join(sourcePath, 'preview.png'), targetpreview);
                }
			}
		}, err => ret.error(err), () => ret.complete());

		ret.subscribe();
		return ret.toPromise();
	}

    public async createTar(): Promise<Readable> {
		const list = await this.walk().pipe(
			pluck('file'),
			map(x => p.relative(this.path, x)),
			toArray())
			.toPromise();

		console.log(`Tar-ing ${this.path}...`);
		return tar.create({
			gzip: true,
			cwd: this.path,
			noDirRecurse: true,
		},
			list
		)
	}

/*
    async package(sourcePath: string) {
        return asyncReadDir(sourcePath, [
            (file: FileEntry) =>
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
                        await asyncfile.writeTextFile(targetname, rel.replace(/\\/g, '/'));
                        fs.copyFileSync(file, targetasset);
                        fs.copyFileSync(metafile, targetmeta);
                        if (p.extname(file) === '.png') {
                            fs.copyFileSync(join(sourcePath, 'preview.png'), targetpreview);
                        }

                        const dir = p.dirname(file);
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
                        await asyncfile.writeTextFile(targetname, rel.replace(/\\/g, '/'));
                        const dirname = p.dirname(targetname);
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
    */
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

const sourcePath: string = p.resolve(options.path);
const targetZipPath: string = p.join(options.out, `${options.file}.unitypackage`);
const targetMd5Path: string = p.join(options.out, `${options.file}.unitypackage.md5`);

(async () => {
    const packagedPath = await TreeWalker.getTempDir();
    await TreeWalker.copy(sourcePath, packagedPath, ["/*", "/*/", "!/Assets/", "*.meta", "*.pdb"]);

    let zip = await new TreeWalker(packagedPath).createTar();

    await asyncfile.mkdirp(p.dirname(targetZipPath))

    zip
     .pipe(asyncfile.createWriteStream(targetZipPath))
     .on('finish', async () => {
        const hash = md5(await asyncfile.readFile(targetZipPath));
        await asyncfile.writeTextFile(targetMd5Path, hash);
        console.log(`${targetZipPath} and ${targetMd5Path} created`);
    });
})();
