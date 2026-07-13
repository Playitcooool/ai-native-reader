import fs from "node:fs";

const bump = process.argv[2];
const readJson = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
const writeJson = (path, data) => fs.writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
const matchVersion = (path, pattern) => {
  const match = fs.readFileSync(path, "utf8").match(pattern);
  if (!match) throw new Error(`No version found in ${path}`);
  return match[1];
};

const pkg = readJson("package.json");
const lock = readJson("package-lock.json");
const versions = new Map([
  ["package.json", pkg.version],
  ["package-lock.json", lock.version],
  ["package-lock.json root", lock.packages[""].version],
  ["Cargo.toml", matchVersion("src-tauri/Cargo.toml", /^version = "(\d+\.\d+\.\d+)"/m)],
  ["Cargo.lock", matchVersion("src-tauri/Cargo.lock", /\[\[package\]\]\nname = "rustybooks"\nversion = "(\d+\.\d+\.\d+)"/)],
  ["tauri.conf.json", readJson("src-tauri/tauri.conf.json").version],
  ["README.md", matchVersion("README.md", /Current version: \*\*(\d+\.\d+\.\d+)\*\*/)],
]);
const current = pkg.version;
for (const [file, version] of versions) {
  if (version !== current) throw new Error(`Version mismatch: ${file} has ${version}, expected ${current}`);
}

const parts = current.split(".").map(Number);
if (parts.length !== 3 || parts.some((part) => !Number.isSafeInteger(part) || part < 0)) {
  throw new Error(`Unsupported version: ${current}`);
}
if (bump === "major") parts.splice(0, 3, parts[0] + 1, 0, 0);
else if (bump === "minor") parts.splice(1, 2, parts[1] + 1, 0);
else if (bump === "patch") parts[2] += 1;
else throw new Error(`Unsupported bump: ${bump}`);
const nextVersion = parts.join(".");

pkg.version = nextVersion;
writeJson("package.json", pkg);
lock.version = nextVersion;
lock.packages[""].version = nextVersion;
writeJson("package-lock.json", lock);

const replace = (path, pattern, value) => {
  const text = fs.readFileSync(path, "utf8");
  const next = text.replace(pattern, value);
  if (next === text) throw new Error(`No version replaced in ${path}`);
  fs.writeFileSync(path, next);
};
replace("src-tauri/Cargo.toml", /^version = "\d+\.\d+\.\d+"/m, `version = "${nextVersion}"`);
replace("src-tauri/tauri.conf.json", /"version": "\d+\.\d+\.\d+"/, `"version": "${nextVersion}"`);
replace(
  "src-tauri/Cargo.lock",
  /(\[\[package\]\]\nname = "rustybooks"\nversion = )"\d+\.\d+\.\d+"/,
  `$1"${nextVersion}"`,
);
replace("README.md", /Current version: \*\*\d+\.\d+\.\d+\*\*/, `Current version: **${nextVersion}**`);

if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${nextVersion}\n`);
console.log(nextVersion);
