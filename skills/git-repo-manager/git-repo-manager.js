/**
 * Git Repo Manager - Git 仓库管理工具
 * 用于本地仓库的克隆、拉取、分支管理和文件操作
 * 支持同步推送（带超时）和异步推送（定时任务重试）
 */

const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

// 内存中存储重试状态
const retryState = new Map();

/**
 * 执行 shell 命令，返回 Promise，支持超时
 * @param {string} command - 命令
 * @param {string} cwd - 工作目录
 * @param {number} timeoutMs - 超时时间（毫秒）
 * @returns {Promise<string>} 命令输出
 */
function execPromise(command, cwd = null, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const options = cwd ? { cwd, timeout: timeoutMs } : { timeout: timeoutMs };
    const child = exec(command, options, (error, stdout, stderr) => {
      if (error) {
        // 判断是否是超时错误
        if (error.killed && error.signal === 'SIGTERM') {
          reject(new Error('TIMEOUT'));
        } else {
          reject(new Error(stderr || stdout || error.message));
        }
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

/**
 * 构建带 token 的仓库 URL
 * @param {string} repoUrl - 原始仓库 URL
 * @param {string} token - GitHub token
 * @returns {string} 带认证的 URL
 */
function buildAuthUrl(repoUrl, token) {
  if (!token) return repoUrl;
  
  // 处理 https://github.com/user/repo 格式
  if (repoUrl.startsWith('https://')) {
    const url = new URL(repoUrl);
    url.username = token;
    return url.toString();
  }
  
  return repoUrl;
}

/**
 * 克隆仓库
 * @param {string} repoUrl - 仓库 URL
 * @param {string} localPath - 本地路径
 * @param {string} token - GitHub token（可选）
 * @param {number} timeoutMs - 超时时间（毫秒，默认 10000）
 * @returns {Promise<string>} 克隆结果
 */
async function clone(repoUrl, localPath, token = null, timeoutMs = 10000) {
  try {
    // 确保父目录存在
    const parentDir = path.dirname(localPath);
    await fs.mkdir(parentDir, { recursive: true });
    
    const authUrl = buildAuthUrl(repoUrl, token);
    const command = `git clone "${authUrl}" "${localPath}"`;
    
    return await execPromise(command, null, timeoutMs);
  } catch (error) {
    throw new Error(`Clone failed: ${error.message}`);
  }
}

/**
 * 拉取最新代码
 * @param {string} localPath - 本地仓库路径
 * @param {number} timeoutMs - 超时时间（毫秒，默认 10000）
 * @returns {Promise<string>} 拉取结果
 */
async function pull(localPath, timeoutMs = 10000) {
  try {
    return await execPromise('git pull', localPath, timeoutMs);
  } catch (error) {
    throw new Error(`Pull failed: ${error.message}`);
  }
}

/**
 * 获取远程分支信息
 * @param {string} localPath - 本地仓库路径
 * @param {number} timeoutMs - 超时时间（毫秒，默认 10000）
 * @returns {Promise<string>} fetch 结果
 */
async function fetch(localPath, timeoutMs = 10000) {
  try {
    return await execPromise('git fetch --all', localPath, timeoutMs);
  } catch (error) {
    throw new Error(`Fetch failed: ${error.message}`);
  }
}

/**
 * 切换分支
 * @param {string} localPath - 本地仓库路径
 * @param {string} branch - 分支名称
 * @param {number} timeoutMs - 超时时间（毫秒，默认 10000）
 * @returns {Promise<string>} checkout 结果
 */
async function checkout(localPath, branch, timeoutMs = 10000) {
  try {
    return await execPromise(`git checkout "${branch}"`, localPath, timeoutMs);
  } catch (error) {
    throw new Error(`Checkout failed: ${error.message}`);
  }
}

/**
 * 创建新分支
 * @param {string} localPath - 本地仓库路径
 * @param {string} branchName - 新分支名称
 * @param {string} baseBranch - 基础分支（默认 main）
 * @param {number} timeoutMs - 超时时间（毫秒，默认 10000）
 * @returns {Promise<string>} 创建结果
 */
async function createBranch(localPath, branchName, baseBranch = 'main', timeoutMs = 10000) {
  try {
    // 先切换到基础分支
    await checkout(localPath, baseBranch, timeoutMs);
    // 创建并切换到新分支
    return await execPromise(`git checkout -b "${branchName}"`, localPath, timeoutMs);
  } catch (error) {
    throw new Error(`Create branch failed: ${error.message}`);
  }
}

/**
 * 提交更改
 * @param {string} localPath - 本地仓库路径
 * @param {string} message - 提交信息
 * @param {Array<string>} files - 要提交的文件列表（可选，默认全部）
 * @returns {Promise<string>} 提交结果
 */
async function commit(localPath, message, files = null) {
  try {
    // 添加文件
    if (files && files.length > 0) {
      const filePaths = files.map(f => `"${f}"`).join(' ');
      await execPromise(`git add ${filePaths}`, localPath, 5000);
    } else {
      await execPromise('git add -A', localPath, 5000);
    }
    
    // 提交
    return await execPromise(`git commit -m "${message}"`, localPath, 5000);
  } catch (error) {
    throw new Error(`Commit failed: ${error.message}`);
  }
}

/**
 * 同步推送到远程（带超时）
 * @param {string} localPath - 本地仓库路径
 * @param {string} branch - 分支名称
 * @param {number} timeoutMs - 超时时间（毫秒，默认 10000）
 * @returns {Promise<{success: boolean, error?: string, timeout?: boolean}>} 推送结果
 */
async function pushSync(localPath, branch, timeoutMs = 10000) {
  try {
    await execPromise(`git push origin "${branch}"`, localPath, timeoutMs);
    return { success: true };
  } catch (error) {
    if (error.message === 'TIMEOUT') {
      return { success: false, timeout: true, error: '推送超时' };
    }
    return { success: false, error: error.message };
  }
}

/**
 * 异步推送到远程（创建定时任务重试）
 * @param {string} localPath - 本地仓库路径
 * @param {string} branch - 分支名称
 * @param {Object} options - 配置选项
 * @param {number} options.maxRetries - 最大重试次数（默认 5）
 * @param {number} options.intervalMinutes - 重试间隔（分钟，默认 5）
 * @param {number} options.timeoutMs - 每次推送超时（毫秒，默认 10000）
 * @returns {Promise<{jobId: string, status: string, message: string}>} 任务信息
 */
async function pushAsync(localPath, branch, options = {}) {
  const { 
    maxRetries = 5, 
    intervalMinutes = 5, 
    timeoutMs = 10000 
  } = options;
  
  const jobId = `git-push-${Date.now()}`;
  const stateKey = `${localPath}:${branch}`;
  
  // 初始化重试状态
  retryState.set(stateKey, {
    jobId,
    localPath,
    branch,
    retries: 0,
    maxRetries,
    timeoutMs,
    createdAt: Date.now()
  });
  
  // 创建 cron 任务
  const cronJob = {
    name: jobId,
    schedule: { 
      kind: 'every', 
      everyMs: intervalMinutes * 60 * 1000 
    },
    payload: {
      kind: 'agentTurn',
      message: `[git-retry] localPath="${localPath}" branch="${branch}" jobId="${jobId}"`
    },
    sessionTarget: 'isolated',
    enabled: true
  };
  
  // 使用 cron 工具创建任务（这里返回任务信息，实际创建由调用方处理）
  return {
    jobId,
    status: 'scheduled',
    message: `已创建异步推送任务，最多重试 ${maxRetries} 次，间隔 ${intervalMinutes} 分钟`,
    cronJob
  };
}

/**
 * 执行重试推送（由 cron 任务调用）
 * @param {string} localPath - 本地仓库路径
 * @param {string} branch - 分支名称
 * @param {string} jobId - 任务 ID
 * @returns {Promise<{success: boolean, done: boolean, message: string}>} 执行结果
 */
async function executeRetryPush(localPath, branch, jobId) {
  const stateKey = `${localPath}:${branch}`;
  const state = retryState.get(stateKey);
  
  if (!state) {
    return { success: false, done: true, message: '任务状态丢失，停止重试' };
  }
  
  if (state.retries >= state.maxRetries) {
    retryState.delete(stateKey);
    return { success: false, done: true, message: `已达到最大重试次数 (${state.maxRetries})，推送失败` };
  }
  
  // 增加重试计数
  state.retries++;
  retryState.set(stateKey, state);
  
  // 执行推送
  const result = await pushSync(localPath, branch, state.timeoutMs);
  
  if (result.success) {
    retryState.delete(stateKey);
    return { success: true, done: true, message: `第 ${state.retries} 次重试成功` };
  }
  
  if (state.retries >= state.maxRetries) {
    retryState.delete(stateKey);
    return { success: false, done: true, message: `第 ${state.retries} 次重试失败，已达上限: ${result.error}` };
  }
  
  return { 
    success: false, 
    done: false, 
    message: `第 ${state.retries} 次重试失败，将继续重试: ${result.error}` 
  };
}

/**
 * 读取本地文件内容
 * @param {string} localPath - 本地仓库路径
 * @param {string} filePath - 文件相对路径
 * @returns {Promise<string>} 文件内容
 */
async function readFile(localPath, filePath) {
  try {
    const fullPath = path.join(localPath, filePath);
    return await fs.readFile(fullPath, 'utf-8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw new Error(`Read file failed: ${error.message}`);
  }
}

/**
 * 写入本地文件
 * @param {string} localPath - 本地仓库路径
 * @param {string} filePath - 文件相对路径
 * @param {string} content - 文件内容
 * @returns {Promise<void>}
 */
async function writeFile(localPath, filePath, content) {
  try {
    const fullPath = path.join(localPath, filePath);
    
    // 确保父目录存在
    const parentDir = path.dirname(fullPath);
    await fs.mkdir(parentDir, { recursive: true });
    
    await fs.writeFile(fullPath, content, 'utf-8');
  } catch (error) {
    throw new Error(`Write file failed: ${error.message}`);
  }
}

/**
 * 递归列出目录下所有 markdown 文件
 * @param {string} localPath - 本地仓库路径
 * @param {string} dir - 目录相对路径（可选，默认根目录）
 * @returns {Promise<Array<string>>} 文件路径列表
 */
async function listFiles(localPath, dir = '') {
  const results = [];
  const targetDir = path.join(localPath, dir);
  
  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(localPath, fullPath);
      
      if (entry.isDirectory()) {
        // 跳过 .git 目录
        if (entry.name === '.git') continue;
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(relativePath);
      }
    }
  }
  
  try {
    await walk(targetDir);
    return results;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw new Error(`List files failed: ${error.message}`);
  }
}

/**
 * 检查文件是否存在
 * @param {string} localPath - 本地仓库路径
 * @param {string} filePath - 文件相对路径
 * @returns {Promise<boolean>} 是否存在
 */
async function fileExists(localPath, filePath) {
  try {
    const fullPath = path.join(localPath, filePath);
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 确保仓库存在（不存在则 clone，存在则 pull）
 * @param {string} localPath - 本地仓库路径
 * @param {string} repoUrl - 仓库 URL
 * @param {string} token - GitHub token（可选）
 * @param {number} timeoutMs - 超时时间（毫秒，默认 10000）
 * @returns {Promise<string>} 操作结果
 */
async function ensureRepo(localPath, repoUrl, token = null, timeoutMs = 10000) {
  try {
    // 检查目录是否存在
    const exists = await fileExists(localPath, '.git');
    
    if (exists) {
      // 存在则拉取最新代码
      return await pull(localPath, timeoutMs);
    } else {
      // 不存在则克隆
      return await clone(repoUrl, localPath, token, timeoutMs);
    }
  } catch (error) {
    throw new Error(`Ensure repo failed: ${error.message}`);
  }
}

module.exports = {
  clone,
  pull,
  fetch,
  checkout,
  createBranch,
  commit,
  pushSync,
  pushAsync,
  executeRetryPush,
  readFile,
  writeFile,
  listFiles,
  fileExists,
  ensureRepo
};
