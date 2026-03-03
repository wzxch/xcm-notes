# github-notes Skill

GitHub API 操作工具，用于读取、创建和更新 GitHub 仓库中的 Markdown 笔记文件。

## 配置方式

支持三种配置方式，**推荐方式一**：

### 方式一：使用 init() 方法（推荐）

```javascript
const github = require('./github-notes');

// 初始化配置
github.init({
  token: 'ghp_xxxxxxxx',      // GitHub Personal Access Token
  repo: 'owner/repo',          // 仓库名，如：wzxch/xcm-notes
  username: 'your_username',   // GitHub 用户名
  authorName: 'Your Name'      // Git commit 作者名（可选）
});
```

### 方式二：配置文件（自动读取）

在 `git-repo-manager/config.json` 中配置：

```json
{
  "repoUrl": "https://github.com/wzxch/xcm-notes",
  "localPath": "/path/to/repo",
  "token": "ghp_xxxxxxxx",
  "username": "your_username"
}
```

`github-notes` 会自动读取该配置文件。

### 方式三：环境变量（向后兼容）

```bash
export GITHUB_TOKEN="ghp_xxxxxxxx"      # GitHub Personal Access Token
export GITHUB_REPO="owner/repo"          # 仓库名，如：wzxch/xcm-notes
export GITHUB_USERNAME="your_username"   # GitHub 用户名
export GITHUB_AUTHOR_NAME="Your Name"    # Git commit 作者名（可选）
```

## 功能

### 1. 读取文件

```javascript
const github = require('./github-notes');
github.init({ token: 'ghp_xxx', repo: 'wzxch/xcm-notes', username: 'wzxch' });

const content = await github.readFile('java/jvm-gc.md');
```

### 2. 列出目录

```javascript
const files = await github.listDirectory('java');
```

### 3. 创建/更新文件

```javascript
await github.createOrUpdateFile('java/new-topic.md', '# 新主题\n\n内容...', '添加新主题笔记');
```

### 4. 创建临时分支

```javascript
await github.createBranch('note-jvm-gc-20250225');
```

### 5. 创建 Pull Request

```javascript
const pr = await github.createPullRequest('note-jvm-gc-20250225', 'Add: jvm-gc-20250225', '添加 JVM GC 笔记');
console.log(pr.html_url);
```

## 完整工作流示例

```javascript
const github = require('./github-notes');

// 1. 初始化
github.init({
  token: 'ghp_xxxxxxxx',
  repo: 'wzxch/xcm-notes',
  username: 'wzxch',
  authorName: 'GitHub Notes Bot'
});

// 2. 创建临时分支
await github.createBranch('note-topic-20250225');

// 3. 创建/更新文件
await github.createOrUpdateFile(
  'java/topic.md',
  '# 主题\n\n内容',
  '添加主题笔记',
  'note-topic-20250225'
);

// 4. 创建 PR
const pr = await github.createPullRequest(
  'note-topic-20250225',
  'Add: topic-20250225',
  '添加主题笔记'
);

console.log('PR 链接:', pr.html_url);
```

## API 参考

### init(config)
- `config.token`: GitHub Personal Access Token
- `config.repo`: 仓库名，格式 `owner/repo`
- `config.username`: GitHub 用户名
- `config.authorName`: Git commit 作者名（可选，默认 'GitHub Notes Bot'）

### readFile(path, branch?)
- `path`: 文件路径（相对于仓库根目录）
- `branch`: 分支名（可选，默认 main）
- 返回: 文件内容字符串，文件不存在返回 null

### listDirectory(path)
- `path`: 目录路径（相对于仓库根目录）
- 返回: 文件和目录列表数组

### createOrUpdateFile(path, content, message, branch?)
- `path`: 文件路径
- `content`: 文件内容
- `message`: commit 消息
- `branch`: 分支名（可选，默认 main）

### createBranch(branchName, baseBranch?)
- `branchName`: 新分支名
- `baseBranch`: 基础分支（可选，默认 main）

### createPullRequest(head, title, body, base?)
- `head`: 源分支名
- `title`: PR 标题
- `body`: PR 描述
- `base`: 目标分支（可选，默认 main）
- 返回: PR 对象，包含 `html_url`
