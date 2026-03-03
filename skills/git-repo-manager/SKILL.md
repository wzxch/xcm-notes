# git-repo-manager Skill

Git 仓库管理工具，用于本地仓库的克隆、拉取、分支管理和文件操作。
支持同步推送（带超时）和异步推送（定时任务自动重试）。

## 配置

编辑 `config.json` 配置仓库信息：

```json
{
  "repoUrl": "https://github.com/wzxch/xcm-notes",
  "localPath": "/root/.openclaw/workspace/repos/xcm-notes",
  "token": "your-github-token"
}
```

## API 方法

### clone(repoUrl, localPath, token, timeoutMs?)
克隆仓库到本地路径。

```javascript
const git = require('./git-repo-manager');
await git.clone(
  'https://github.com/user/repo',
  '/path/to/local',
  'ghp_xxxxxxxx',
  15000  // 超时 15 秒
);
```

### pull(localPath, timeoutMs?)
拉取最新代码。

```javascript
await git.pull('/path/to/repo', 10000);
```

### fetch(localPath, timeoutMs?)
获取远程分支信息。

```javascript
await git.fetch('/path/to/repo', 10000);
```

### checkout(localPath, branch, timeoutMs?)
切换到指定分支。

```javascript
await git.checkout('/path/to/repo', 'main', 10000);
```

### createBranch(localPath, branchName, baseBranch?, timeoutMs?)
基于指定分支创建新分支。

```javascript
await git.createBranch('/path/to/repo', 'feature-branch', 'main', 10000);
```

### commit(localPath, message, files?)
提交更改到本地仓库。

```javascript
await git.commit('/path/to/repo', 'Add new feature', ['file1.js', 'file2.js']);
```

### pushSync(localPath, branch, timeoutMs?)
**同步推送到远程（带超时）**

```javascript
const result = await git.pushSync('/path/to/repo', 'main', 10000);

if (result.success) {
  console.log('推送成功');
} else if (result.timeout) {
  console.log('推送超时');
} else {
  console.log('推送失败:', result.error);
}
```

返回结果：
- `success: true` - 推送成功
- `success: false, timeout: true` - 推送超时
- `success: false, error: string` - 其他错误

### pushAsync(localPath, branch, options?)
**异步推送到远程（创建定时任务重试）**

适用于网络不稳定场景，自动创建 cron 任务重试推送。

```javascript
const job = await git.pushAsync('/path/to/repo', 'main', {
  maxRetries: 5,        // 最大重试次数（默认 5）
  intervalMinutes: 5,   // 重试间隔（分钟，默认 5）
  timeoutMs: 10000      // 每次推送超时（毫秒，默认 10000）
});

console.log(job.jobId);      // 任务 ID
console.log(job.status);     // 'scheduled'
console.log(job.message);    // 任务描述
console.log(job.cronJob);    // cron 任务配置（用于创建任务）
```

### executeRetryPush(localPath, branch, jobId)
**执行重试推送（由 cron 任务调用）**

```javascript
const result = await git.executeRetryPush('/path/to/repo', 'main', 'git-push-123456');

console.log(result.success);  // 是否成功
console.log(result.done);     // 是否结束（成功或达到重试上限）
console.log(result.message);  // 详细信息
```

### readFile(localPath, filePath)
读取本地文件内容。

```javascript
const content = await git.readFile('/path/to/repo', 'README.md');
```

### writeFile(localPath, filePath, content)
写入内容到本地文件。

```javascript
await git.writeFile('/path/to/repo', 'notes.md', '# Hello World');
```

### listFiles(localPath, dir?)
递归列出目录下所有 markdown 文件。

```javascript
const files = await git.listFiles('/path/to/repo', 'docs');
// 返回: ['docs/guide.md', 'docs/api.md', ...]
```

### fileExists(localPath, filePath)
检查文件是否存在。

```javascript
const exists = await git.fileExists('/path/to/repo', 'README.md');
```

### ensureRepo(localPath, repoUrl, token?, timeoutMs?)
确保仓库存在（不存在则 clone，存在则 pull）。

```javascript
await git.ensureRepo(
  '/path/to/repo',
  'https://github.com/user/repo',
  'ghp_xxxxxxxx',
  15000
);
```

## 使用示例

### 完整工作流（同步推送）

```javascript
const git = require('./git-repo-manager');

// 1. 确保仓库存在
await git.ensureRepo(
  '/root/.openclaw/workspace/repos/notes',
  'https://github.com/user/notes',
  'ghp_xxxxxxxx'
);

// 2. 创建新分支
await git.createBranch('/root/.openclaw/workspace/repos/notes', 'new-feature', 'main');

// 3. 写入文件
await git.writeFile(
  '/root/.openclaw/workspace/repos/notes',
  'new-file.md',
  '# New Content'
);

// 4. 提交更改
await git.commit('/root/.openclaw/workspace/repos/notes', 'Add new file', ['new-file.md']);

// 5. 同步推送（带超时）
const result = await git.pushSync('/root/.openclaw/workspace/repos/notes', 'new-feature', 10000);
if (!result.success) {
  console.error('推送失败:', result.error);
}
```

### 异步推送（网络不稳定场景）

```javascript
const git = require('./git-repo-manager');

// 1-4 同上...

// 5. 异步推送（创建定时任务）
const job = await git.pushAsync('/root/.openclaw/workspace/repos/notes', 'new-feature', {
  maxRetries: 5,
  intervalMinutes: 5,
  timeoutMs: 10000
});

console.log('任务已创建:', job.jobId);
// 返回: { jobId: 'git-push-123456', status: 'scheduled', message: '...', cronJob: {...} }

// 使用返回的 cronJob 创建定时任务
// await cron.add(job.cronJob);
```

## 错误处理

所有方法都返回 Promise，使用 try-catch 处理错误：

```javascript
try {
  await git.clone(repoUrl, localPath, token);
} catch (error) {
  console.error('Clone failed:', error.message);
}
```

## 依赖

- Node.js child_process 模块
- 本地安装 Git
