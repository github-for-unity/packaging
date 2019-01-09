#!/usr/bin/env node_modules/.bin/ts-node

import { resolve, join, relative, dirname } from 'path';
import asyncfile from 'async-file';
import commandLineArgs from 'command-line-args';
import commandLineUsage from 'command-line-usage';
import octokit from '@octokit/rest';
import fs, { mkdirSync } from 'fs';
import path from 'path';
import request from 'request-promise';
import aws from 'aws-sdk';
import readdir from 'recursive-readdir';
import tmp from 'tmp';

const optionDefinitions = [
    {
        name: 'help',
        alias: 'h',
        description: 'Display this usage guide.',
    },
    {
        name: 'dryrun',
        alias: 'n',
        description: 'Show what would happen but don\'t upload',
    },
    {
        name: 'git',
        alias: 'g',
        description: 'Upload git zip',
    },
    {
        name: 'package',
        alias: 'u',
        description: 'Upload unity package',
    },
    {
        name: 'feed',
        alias: 'f',
        description: 'Upload latest release feed from disk',
    },
    {
        name: 'online',
        alias: 'o',
        description: 'Download latest.json from latest github release and upload it',
    },
    {
        name: 'path',
        alias: 'p',
        typeLabel: '{underline directory}',
        description: 'Path to the files to be uploaded',
    },
];

const sections = [
    {
        header: 'Upload to aws',
        content: '',
    },
    {
        header: 'Options',
        optionList: optionDefinitions,
    },
];

const Acl = 'public-read';
const Bucket = 'github-vs';
const S3Path = 'unity';

const s3 = new aws.S3( {
    region: 'us-east-1',
    signatureVersion: 'v4',
    accessKeyId: process.env.AWS_S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY,
});

const ContentTypes: Map<string, string> = new Map([
    [ 'gitconfig', 'text/plain' ] ,
    [ '.txt', 'text/plain' ],
    [ '.md5', 'text/plain' ],
    ['.json', 'application/json' ],
]);

enum UploadType {
    None,
    Feed,
    Git,
    Package
}

const FilesPerTypeOfUpload: Map<UploadType, string[]> = new Map([
    [ UploadType.Feed, ['latest.json'] ],
    [ UploadType.Git, [ 'git-lfs.zip', 'git-lfs.json', 'git.zip', 'git.json', 'gitconfig'] ],
    [ UploadType.Package, ['.unitypackage', '.unitypackage.md5'] ],
]);

const S3PathPrefixes: Map<UploadType, string> = new Map([
    [ UploadType.Feed, S3Path ],
    [ UploadType.Git, `${S3Path}/git` ],
    [ UploadType.Package, `${S3Path}/releases` ],
]);

const options = commandLineArgs(optionDefinitions);
const help: boolean = options.help === null;
const dryrun: boolean = options.dryrun === null;

async function upload(file: string, sourceDir: string, targetDir: string) {

    const content = await asyncfile.readFile(file);   
    let key = relative(sourceDir, file).replace(/\\/g, '/');
    key = `${targetDir}/${key}`;

    let type = 'application/octet-stream';
    if (ContentTypes.has(path.extname(key)))
        type = ContentTypes.get(path.extname(key))!;
    else if (ContentTypes.has(path.basename(key)))
        type = ContentTypes.get(path.basename(key))!;
    const disp = type != 'application/octet-stream' ? 'inline' : 'attachment';

    console.log(`${dryrun ? 'Would upload' : 'Uploading'} ${key} ${dryrun ? `from ${file}` : ''} as ${type} ${disp}`);

    if (dryrun) return;

    return s3.putObject({
        ACL: Acl,
        Bucket: Bucket,
        Key: key,
        ContentType: type,
        ContentDisposition: disp,
        CacheControl: 'no-cache',
        Body: content,
    }).on('httpUploadProgress', p => console.log(`${key}: ${p.loaded} of ${p.total}`)).promise();
}

async function uploadDir(path: string, targetDir: string) {
    let files = await readdir(path);
    return Promise.all(files.map(x => upload(x, path, targetDir)));
}

async function copy(source: string, target: string, ignores: string[]) {
    const files = await readdir(source, [ (file: string, stats: asyncfile.Stats) => {
        const filename = relative(source, file)
        if (stats.isDirectory()) return false;
        return ignores.indexOf(path.basename(filename)) < 0 && ignores.filter(x => filename.endsWith(x)).length == 0;
    }]);

    for (const file of files) {
        const relpath = relative(source, file);
        const targetpath = join(target, relpath);
        if (!await asyncfile.exists(path.dirname(targetpath)))
            mkdirSync(path.dirname(targetpath));
        fs.copyFileSync(file, targetpath);
    };
}

(async () => {

    let uploadType: UploadType = UploadType.None;
    if (options.git === null) uploadType = UploadType.Git;
    if (options.package === null) uploadType = UploadType.Package;
    if (options.feed === null || options.online === null) uploadType = UploadType.Feed;
    const online = uploadType === UploadType.Feed && options.online === null;

    if (help || uploadType == UploadType.None || (!online && (!options.path || !asyncfile.exists(options.path)))) {
        console.error(commandLineUsage(sections));
        process.exit(-1);
    }
    
      const tmpdir = await new Promise<string>((resolve, reject) =>
        tmp.dir({ unsafeCleanup: true }, (err, path, _) => err ? reject(err) : resolve(path)));

    if (online) {
        console.log("Downloading latest.json from latest release...");
        var github = new octokit();
        var release = await github.repos.getLatestRelease({ owner: "github-for-unity", repo: "unity" });
        var latest = release.data.assets.filter(x => x.name === 'latest.json');
        if (latest.length == 0) {
            console.error("Release doesn't have a latest.json, you need to create it");
            process.exit(-1);
        }
        var latesturl = latest[0].browser_download_url;
        await request.get(latesturl).then(json => asyncfile.writeTextFile(join(tmpdir, 'latest.json'), json));
    } else {
        const sourcePath: string = resolve(options.path);
        await copy(sourcePath, tmpdir, FilesPerTypeOfUpload.get(uploadType)!);
    }    

    uploadDir(tmpdir, S3PathPrefixes.get(uploadType)!);
})();

