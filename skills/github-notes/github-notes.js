/**
 * GitHub Notes API 操作模块
 * 提供读取、创建、更新文件和分支管理功能
 * 
 * 支持两种配置方式：
 * 1. 环境变量：GITHUB_TOKEN, GITHUB_REPO, GITHUB_USERNAME, GITHUB_AUTHOR_NAME
 * 2. init() 方法：传入配置对象
 */

const GITHUB_API = 'https://api.github.com';

// 模块级配置存储
let moduleConfig = null;

/**
 * 初始化配置
 * @param {Object} config - 配置对象
 * @param {string} config.token - GitHub Personal Access Token
 * @param {string} config.repo - 仓库名，如：wzxch/xcm-notes
 * @param {string} config.username - GitHub 用户名
 * @param {string} [config.authorName] - Git commit 作者名（可选）
 */
function init(config) {
  if (!config || !config.token || !config.repo || !config.username) {
    throw new Error('init() 需要提供 token, repo, username');
  }
  moduleConfig = {
    authorName: 'GitHub Notes Bot',
    ...config
  };
}

/**
 * 从环境变量获取配置
 * @returns {Object} 配置对象
 */
function getConfigFromEnv() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const username = process.env.GITHUB_USERNAME;
  const authorName = process.env.GITHUB_AUTHOR_NAME || 'GitHub Notes Bot';

  if (!token || !repo || !username) {
    throw new Error('缺少必要的环境变量: GITHUB_TOKEN, GITHUB_REPO, GITHUB_USERNAME');
  }

  return { token, repo, username, authorName };
}

/**
 * 获取当前配置（优先使用 init() 设置的配置，否则从环境变量读取）
 * @returns {Object} 配置对象
 */
function getConfig() {
  if (moduleConfig) {
    return moduleConfig;
  }
  return getConfigFromEnv();
}

// 构建请求头
function getHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'github-notes-skill'
  };
}

/**
 * 读取文件内容
 * @param {string} path - 文件路径
 * @param {string} branch - 分支名（可选，默认 main）
 * @returns {Promise<string|null>} 文件内容，不存在返回 null
 */
async function readFile(path, branch = 'main') {
  const { token, repo } = getConfig();
  const encodedPath = encodeURIComponent(path);
  const url = `${GITHUB_API}/repos/${repo}/contents/${encodedPath}?ref=${branch}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: getHeaders(token)
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`读取文件失败: ${error.message}`);
    }

    const data = await response.json();
    // 解码 base64 内容
    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    return content;
  } catch (error) {
    if (error.message.includes('404')) {
      return null;
    }
    throw error;
  }
}

/**
 * 列出目录内容
 * @param {string} path - 目录路径（空字符串表示根目录）
 * @param {string} branch - 分支名（可选，默认 main）
 * @returns {Promise<Array>} 文件和目录列表
 */
async function listDirectory(path = '', branch = 'main') {
  const { token, repo } = getConfig();
  const encodedPath = path ? encodeURIComponent(path) : '';
  const url = `${GITHUB_API}/repos/${repo}/contents/${encodedPath}?ref=${branch}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: getHeaders(token)
  });

  if (response.status === 404) {
    return [];
  }

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`列出目录失败: ${error.message}`);
  }

  const data = await response.json();
  return data.map(item => ({
    name: item.name,
    path: item.path,
    type: item.type, // 'file' 或 'dir'
    sha: item.sha
  }));
}

/**
 * 获取文件 SHA（用于更新）
 * @param {string} path - 文件路径
 * @param {string} branch - 分支名
 * @returns {Promise<string|null>} 文件 SHA，不存在返回 null
 */
async function getFileSha(path, branch = 'main') {
  const { token, repo } = getConfig();
  const encodedPath = encodeURIComponent(path);
  const url = `${GITHUB_API}/repos/${repo}/contents/${encodedPath}?ref=${branch}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: getHeaders(token)
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.sha;
  } catch (error) {
    return null;
  }
}

/**
 * 创建或更新文件
 * @param {string} path - 文件路径
 * @param {string} content - 文件内容
 * @param {string} message - commit 消息
 * @param {string} branch - 分支名（可选，默认 main）
 * @returns {Promise<Object>} 创建/更新结果
 */
async function createOrUpdateFile(path, content, message, branch = 'main') {
  const { token, repo, authorName } = getConfig();
  const encodedPath = encodeURIComponent(path);
  const url = `${GITHUB_API}/repos/${repo}/contents/${encodedPath}`;

  // 获取现有文件 SHA（如果存在）
  const sha = await getFileSha(path, branch);

  // 编码内容为 base64
  const encodedContent = Buffer.from(content, 'utf-8').toString('base64');

  const body = {
    message: message,
    content: encodedContent,
    branch: branch,
    committer: {
      name: authorName,
      email: `${authorName}@users.noreply.github.com`
    }
  };

  // 如果是更新，需要添加 SHA
  if (sha) {
    body.sha = sha;
  }

  const response = await fetch(url, {
    method: 'PUT',
    headers: getHeaders(token),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`创建/更新文件失败: ${error.message}`);
  }

  return await response.json();
}

/**
 * 获取默认分支的 SHA
 * @param {string} branch - 分支名（默认 main）
 * @returns {Promise<string>} 分支 SHA
 */
async function getBranchSha(branch = 'main') {
  const { token, repo } = getConfig();
  const url = `${GITHUB_API}/repos/${repo}/git/ref/heads/${branch}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: getHeaders(token)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`获取分支 SHA 失败: ${error.message}`);
  }

  const data = await response.json();
  return data.object.sha;
}

/**
 * 创建新分支
 * @param {string} branchName - 新分支名
 * @param {string} baseBranch - 基础分支（可选，默认 main）
 * @returns {Promise<Object>} 创建结果
 */
async function createBranch(branchName, baseBranch = 'main') {
  const { token, repo } = getConfig();
  const url = `${GITHUB_API}/repos/${repo}/git/refs`;

  // 获取基础分支的 SHA
  const sha = await getBranchSha(baseBranch);

  const body = {
    ref: `refs/heads/${branchName}`,
    sha: sha
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.json();
    // 分支已存在
    if (error.message && error.message.includes('already exists')) {
      return { message: 'Branch already exists', branch: branchName };
    }
    throw new Error(`创建分支失败: ${error.message}`);
  }

  return await response.json();
}

/**
 * 创建 Pull Request
 * @param {string} head - 源分支名
 * @param {string} title - PR 标题
 * @param {string} body - PR 描述
 * @param {string} base - 目标分支（可选，默认 main）
 * @returns {Promise<Object>} PR 对象
 */
async function createPullRequest(head, title, body, base = 'main') {
  const { token, repo } = getConfig();
  const url = `${GITHUB_API}/repos/${repo}/pulls`;

  const requestBody = {
    title: title,
    body: body,
    head: head,
    base: base
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(token),
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`创建 PR 失败: ${error.message}`);
  }

  return await response.json();
}

/**
 * 检查文件是否存在
 * @param {string} path - 文件路径
 * @param {string} branch - 分支名（可选，默认 main）
 * @returns {Promise<boolean>} 是否存在
 */
async function fileExists(path, branch = 'main') {
  const content = await readFile(path, branch);
  return content !== null;
}

/**
 * 递归列出所有文件（包括子目录）
 * @param {string} path - 起始路径
 * @param {string} branch - 分支名
 * @returns {Promise<Array>} 所有文件列表
 */
async function listAllFiles(path = '', branch = 'main') {
  const items = await listDirectory(path, branch);
  let files = [];

  for (const item of items) {
    if (item.type === 'file' && item.name.endsWith('.md')) {
      files.push(item);
    } else if (item.type === 'dir') {
      const subFiles = await listAllFiles(item.path, branch);
      files = files.concat(subFiles);
    }
  }

  return files;
}

module.exports = {
  init,
  readFile,
  listDirectory,
  listAllFiles,
  createOrUpdateFile,
  createBranch,
  createPullRequest,
  getFileSha,
  fileExists,
  getConfig
};
