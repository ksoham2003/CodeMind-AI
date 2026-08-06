const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs');
const { rimraf } = require('rimraf');

const TEMP_DIR = path.join(__dirname, '../../..', process.env.TEMP_DIR || 'temp');

/**
 * Ensure temp directory exists
 */
const ensureTempDir = () => {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
};

/**
 * Parse GitHub URL and return { owner, repo, cloneUrl }
 */
const parseGithubUrl = (url) => {
  // Support: https://github.com/owner/repo, https://github.com/owner/repo.git
  const match = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/.*)?$/);
  if (!match) throw new Error('Invalid GitHub URL. Expected format: https://github.com/owner/repo');
  const [, owner, repo] = match;
  const cloneUrl = process.env.GITHUB_TOKEN
    ? `https://${process.env.GITHUB_TOKEN}@github.com/${owner}/${repo}.git`
    : `https://github.com/${owner}/${repo}.git`;
  return { owner, repo, cloneUrl };
};

/**
 * Clone a GitHub repository to a local temp path
 * @param {string} githubUrl - Public GitHub URL
 * @param {string} repoId - Unique ID for this repo instance
 * @param {Function} onProgress - Progress callback(stage, message)
 * @returns {string} Local path to cloned repo
 */
const cloneRepository = async (githubUrl, repoId, onProgress = () => {}) => {
  ensureTempDir();
  const { owner, repo, cloneUrl } = parseGithubUrl(githubUrl);
  const localPath = path.join(TEMP_DIR, repoId);

  // Clean up if already exists
  if (fs.existsSync(localPath)) {
    await rimraf(localPath);
  }

  onProgress('cloning', `Cloning ${owner}/${repo}...`);

  const git = simpleGit();
  await git.clone(cloneUrl, localPath, ['--depth=1']);

  onProgress('cloning', `Successfully cloned ${owner}/${repo}`);
  return localPath;
};

/**
 * Recursively read all files in a directory
 * @param {string} dirPath - Root directory
 * @param {string[]} extensions - Allowed extensions e.g. ['.js', '.ts']
 * @param {string} rootPath - Used to compute relative paths
 * @returns {{ path: string, relativePath: string, content: string }[]}
 */
const readRepositoryFiles = (dirPath, extensions, rootPath = dirPath) => {
  const files = [];
  const IGNORED_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', 'coverage',
    '__pycache__', '.venv', 'vendor', 'target', '.idea', '.vscode',
    'out', '.nuxt', '.cache', 'tmp', 'temp',
  ]);

  const walk = (currentPath) => {
    let entries;
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          walk(path.join(currentPath, entry.name));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          const fullPath = path.join(currentPath, entry.name);
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            // Skip minified files (single long line > 2000 chars)
            const lines = content.split('\n');
            const isMinified = lines.length === 1 && content.length > 2000;
            if (!isMinified && content.trim().length > 0) {
              files.push({
                path: fullPath,
                relativePath: path.relative(rootPath, fullPath).replace(/\\/g, '/'),
                content,
                extension: ext,
              });
            }
          } catch {
            // Skip unreadable files
          }
        }
      }
    }
  };

  walk(dirPath);
  return files;
};

/**
 * Build a file tree structure from a list of file paths
 */
const buildFileTree = (files) => {
  const tree = { name: 'root', type: 'directory', children: [] };

  for (const file of files) {
    const parts = file.relativePath.split('/');
    let current = tree;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;

      if (isFile) {
        current.children.push({
          name: part,
          type: 'file',
          path: file.relativePath,
          extension: file.extension,
        });
      } else {
        let dir = current.children.find((c) => c.name === part && c.type === 'directory');
        if (!dir) {
          dir = { name: part, type: 'directory', children: [] };
          current.children.push(dir);
        }
        current = dir;
      }
    }
  }

  return tree;
};

/**
 * Delete a cloned repository from temp
 */
const deleteRepository = async (repoId) => {
  const localPath = path.join(TEMP_DIR, repoId);
  if (fs.existsSync(localPath)) {
    await rimraf(localPath);
  }
};

module.exports = {
  parseGithubUrl,
  cloneRepository,
  readRepositoryFiles,
  buildFileTree,
  deleteRepository,
};
