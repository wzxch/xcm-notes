/**
 * Session Knowledge Manager - 会话知识管理工具
 * 将对话内容整理成结构化笔记并持久化保存到 GitHub
 */

const fs = require('fs');
const path = require('path');

// ========== 诊断日志 ==========
function diagLog(label, data) {
  const timestamp = new Date().toISOString();
  console.log(`[SKILL-DIAG][${timestamp}] ${label}:`, data);
}

diagLog('环境信息', {
  cwd: process.cwd(),
  __dirname: __dirname,
  scriptPath: __filename
});

// 加载依赖
diagLog('开始加载依赖', '...');

var git, config, github;
var loadErrors = [];

try {
  diagLog('尝试加载', 'git-repo-manager.js');
  git = require('../git-repo-manager/git-repo-manager.js');
  diagLog('加载成功', 'git-repo-manager.js');
} catch (error) {
  loadErrors.push({ module: 'git-repo-manager', error: error.message, stack: error.stack });
  diagLog('加载失败', { module: 'git-repo-manager', error: error.message });
}

try {
  diagLog('尝试加载', 'config.json');
  config = require('../git-repo-manager/config.json');
  diagLog('加载成功', 'config.json');
} catch (error) {
  loadErrors.push({ module: 'config.json', error: error.message, stack: error.stack });
  diagLog('加载失败', { module: 'config.json', error: error.message });
}

try {
  diagLog('尝试加载', 'github-notes.js');
  github = require('../github-notes/github-notes.js');
  diagLog('加载成功', 'github-notes.js');
} catch (error) {
  loadErrors.push({ module: 'github-notes', error: error.message, stack: error.stack });
  diagLog('加载失败', { module: 'github-notes', error: error.message });
}

diagLog('依赖加载完成', { 
  gitLoaded: !!git, 
  configLoaded: !!config, 
  githubLoaded: !!github,
  errors: loadErrors.length 
});

// 配置检查
function checkConfig() {
  if (!git || !config || !config.repoUrl || !config.localPath) {
    return {
      valid: false,
      message: '❌ 配置错误：请检查 git-repo-manager/config.json'
    };
  }
  return { valid: true };
}

/**
 * 生成摘要
 * @param {Array} messages - 对话历史
 * @param {string} topic - 主题名称
 * @returns {Promise<Object>}
 */
async function generateSummary(messages, topic) {
  if (!messages || messages.length === 0) {
    return { success: false, message: '没有对话内容可总结' };
  }

  const finalTopic = topic || '未命名主题';
  
  // 构建提示词，让模型生成结构化内容
  const prompt = buildSummaryPrompt(messages, finalTopic);
  
  return {
    success: true,
    message: '摘要生成提示词已准备',
    prompt: prompt,
    topic: finalTopic,
    tempFile: `/tmp/session-knowledge/${sanitizeFilename(finalTopic)}-${Date.now()}.md`
  };
}

/**
 * 保存笔记到 GitHub
 * @param {string} filePath - 文件路径
 * @param {string} topic - 主题名称（可选）
 * @param {Function} aiGenerateTopic - AI生成主题的函数（可选）
 * @returns {Promise<Object>}
 */
async function saveNotes(filePath, topic, aiGenerateTopic) {
  diagLog('saveNotes 入口', { filePath, topic, cwd: process.cwd() });
  
  const configCheck = checkConfig();
  diagLog('配置检查', configCheck);
  
  if (!configCheck.valid) {
    return { success: false, message: configCheck.message };
  }

  if (!filePath || !fs.existsSync(filePath)) {
    return {
      success: false,
      message: '请提供有效的文件路径',
      needInput: 'filePath'
    };
  }

  try {
    const rawContent = fs.readFileSync(filePath, 'utf-8');
    diagLog('读取文件成功', { filePath, size: rawContent.length });
    
    // 确定主题
    let finalTopic;
    let topicSource;
    
    if (topic) {
      finalTopic = topic;
      topicSource = '用户指定';
    } else {
      const inferred = inferTopicFromContent(rawContent);
      if (inferred) {
        finalTopic = inferred;
        topicSource = '内容推断';
      } else if (aiGenerateTopic) {
        finalTopic = await aiGenerateTopic(rawContent);
        topicSource = 'AI生成';
      } else {
        finalTopic = '未分类笔记';
        topicSource = '默认';
      }
    }

    diagLog('主题确定', { finalTopic, topicSource });

    // 适配为标准格式
    const adaptedContent = adaptToStandardFormat(rawContent, finalTopic);

    // GitHub 操作
    diagLog('开始 GitHub 操作', { localPath: config.localPath, repoUrl: config.repoUrl });
    
    process.env.GITHUB_TOKEN = config.token;
    process.env.GITHUB_REPO = config.repoUrl.replace('https://github.com/', '');
    process.env.GITHUB_USERNAME = config.repoUrl.split('/')[3];

    diagLog('Git 操作', 'ensureRepo...');
    await git.ensureRepo(config.localPath, config.repoUrl, config.token);
    
    diagLog('Git 操作', 'pull...');
    await git.pull(config.localPath);

    const targetPath = getTargetPath(finalTopic);
    diagLog('目标路径', targetPath);
    
    const exists = await git.fileExists(config.localPath, targetPath);
    diagLog('文件是否存在', exists);

    let finalContent = adaptedContent;
    let mergeInfo = '';

    if (exists) {
      const existing = await git.readFile(config.localPath, targetPath);
      finalContent = mergeContent(existing, adaptedContent);
      mergeInfo = '\n🔄 已自动合并历史内容';
    }

    // 自检
    const review = selfReview(finalTopic, finalContent);

    // PR 流程
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const branch = `note-${sanitizeFilename(finalTopic)}-${timestamp}-${Date.now()}`;

    diagLog('PR 流程', { branch, step: 'createBranch' });
    await git.createBranch(config.localPath, branch, 'main');
    
    diagLog('PR 流程', { branch, step: 'checkout' });
    await git.checkout(config.localPath, branch);
    
    diagLog('PR 流程', { branch, step: 'writeFile' });
    await git.writeFile(config.localPath, targetPath, finalContent);
    
    diagLog('PR 流程', { branch, step: 'commit' });
    await git.commit(config.localPath, 
      `${exists ? 'Update' : 'Add'}: ${finalTopic}`, 
      [targetPath]
    );
    
    diagLog('PR 流程', { branch, step: 'push' });
    await git.push(config.localPath, branch);
    
    diagLog('PR 流程', { branch, step: 'checkout main' });
    await git.checkout(config.localPath, 'main');

    diagLog('PR 流程', { branch, step: 'createPullRequest' });
    
    // PR 创建失败时不捕获异常，直接抛出让用户处理
    // 禁止直接提交到 main 分支
    const pr = await github.createPullRequest(branch, 
      `${exists ? 'Update' : 'Add'}：${finalTopic}`,
      buildPRBody(finalTopic, targetPath, exists, mergeInfo, review, topicSource)
    );
    
    diagLog('PR 创建结果', { prUrl: pr?.html_url, prNumber: pr?.number });

    return {
      success: true,
      message: `✅ 笔记已保存并创建 PR\n\n` +
               `📄 文件：${targetPath}${mergeInfo}\n` +
               `📝 操作：${exists ? '更新' : '新增'}\n` +
               `🏷️ 主题：${finalTopic}（${topicSource}）\n` +
               `🔍 自检：${review.summary}\n` +
               `🔗 PR: ${pr?.html_url || '创建成功'}`,
      prUrl: pr?.html_url,
      filePath: targetPath,
      isUpdate: exists,
      topic: finalTopic
    };

  } catch (error) {
    // PR 创建失败时，不捕获异常，直接抛出
    // 确保不会回退到直接提交 main 分支
    diagLog('PR 流程失败', { error: error.message, step: 'createPullRequest' });
    throw new Error(`❌ PR 创建失败：${error.message}\n\n请检查网络连接或手动重试。禁止直接提交到 main 分支。`);
  }
}

/**
 * 检索笔记
 * @param {string} keyword - 关键词
 * @returns {Promise<Object>}
 */
async function searchNotes(keyword) {
  const configCheck = checkConfig();
  if (!configCheck.valid) {
    return { success: false, message: configCheck.message };
  }

  if (!keyword || keyword.trim() === '') {
    return { success: false, message: '请提供搜索关键词' };
  }

  try {
    await git.ensureRepo(config.localPath, config.repoUrl, config.token);
    await git.pull(config.localPath);

    const files = await git.listFiles(config.localPath);
    const term = keyword.toLowerCase().trim();
    const results = [];

    for (const file of files) {
      const content = await git.readFile(config.localPath, file);
      if (!content) continue;

      const filename = file.split('/').pop().toLowerCase();
      const contentLower = content.toLowerCase();

      const nameMatch = filename.includes(term);
      const contentMatch = contentLower.includes(term);

      if (nameMatch || contentMatch) {
        let snippet = '';
        if (contentMatch) {
          const idx = contentLower.indexOf(term);
          const start = Math.max(0, idx - 50);
          const end = Math.min(content.length, idx + term.length + 100);
          snippet = content.substring(start, end).replace(/\n/g, ' ');
          if (start > 0) snippet = '...' + snippet;
          if (end < content.length) snippet = snippet + '...';
        }

        results.push({
          file,
          filename: file.split('/').pop().replace('.md', ''),
          category: file.split('/')[0],
          nameMatch,
          contentMatch,
          snippet
        });
      }
    }

    results.sort((a, b) => (a.nameMatch && !b.nameMatch) ? -1 : 1);

    if (results.length === 0) {
      return { success: true, message: `未找到包含 "${keyword}" 的笔记`, results: [] };
    }

    let message = `🔍 搜索 "${keyword}" 的结果（共 ${results.length} 条）：\n\n`;
    
    const groups = {};
    for (const r of results) {
      if (!groups[r.category]) groups[r.category] = [];
      groups[r.category].push(r);
    }

    for (const [dir, items] of Object.entries(groups)) {
      message += `**${dir}/**\n`;
      for (const item of items) {
        const matchType = item.nameMatch ? '📄' : '📝';
        message += `  ${matchType} ${item.filename}`;
        if (item.snippet) message += `\n     ${item.snippet}`;
        message += '\n';
      }
      message += '\n';
    }

    return { success: true, message, keyword, results };

  } catch (error) {
    return { success: false, message: `搜索失败：${error.message}` };
  }
}

/**
 * 笔记检查
 * @param {string} content - 笔记内容
 * @returns {Object}
 */
function reviewNotes(content) {
  if (!content || content.trim() === '') {
    return { success: false, message: '请提供笔记内容' };
  }

  const reviewPrompt = `你是一名资深技术专家，拥有10年以上后端开发经验，精通Java、JVM、MySQL、Redis、消息队列等核心技术。

你的任务是以严格、挑剔的视角审查以下技术文档，帮助发现潜在问题：

## 审查维度
1. **技术准确性**：概念、原理、数据是否有错误？
2. **表述严谨性**：描述是否过于绝对？是否有歧义？
3. **完整性**：关键细节是否遗漏？边界条件是否说明？
4. **时效性**：内容是否过时？是否有新版本的变化未提及？
5. **常见误区**：是否忽略了初学者容易犯的错误？

## 输出格式
请以以下结构输出审查结果：

### ✅ 整体评价
简要评价文档质量（优秀/良好/需改进）

### 🔍 发现的问题
按严重程度列出发现的问题：
- **严重**：技术错误、概念混淆
- **警告**：表述不严谨、可能误导
- **建议**：可以补充的细节、优化建议

### 📌 修正建议
针对每个问题给出具体的修改建议

---
现在开始审查以下内容：

${content}`;

  return {
    success: true,
    message: '笔记检查提示词已准备',
    prompt: reviewPrompt,
    summary: '等待AI审查结果'
  };
}

// ==================== 工具函数 ====================

function buildSummaryPrompt(messages, topic) {
  const conversation = messages.map(m => `${m.role}: ${m.content}`).join('\n\n');
  
  return `请将以下对话整理成结构化的面试笔记。

主题：${topic}

对话内容：
${conversation}

请按以下格式输出：

# ${topic}

## 核心概念
- **概念1**：简要说明

## 要点总结
1. **问题/要点1**
   详细说明...

## 代码示例
### 示例 1
\`\`\`语言
代码片段
\`\`\`

## 易错点
1. 易错点描述

## 面试要点
- 理解主题的基本原理
- 能够结合实际场景分析
- 了解常见问题和优化方案`;
}

function inferTopicFromContent(content) {
  // 尝试从内容第一行提取标题
  const lines = content.trim().split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# ')) {
      return trimmed.replace('# ', '').trim();
    }
  }
  return null;
}

function adaptToStandardFormat(content, topic) {
  // 如果内容已经是标准格式，直接返回
  if (content.includes('## 核心概念') && content.includes('## 要点总结')) {
    return content;
  }
  
  // 否则包装为标准格式
  return `# ${topic}

## 核心概念
${extractSection(content, '核心概念')}

## 要点总结
${extractSection(content, '要点总结')}

## 代码示例
${extractSection(content, '代码示例')}

## 易错点
${extractSection(content, '易错点')}

## 面试要点
- 理解主题的基本原理
- 能够结合实际场景分析
- 了解常见问题和优化方案

---
*最后更新：${new Date().toLocaleDateString('zh-CN')}*`;
}

function extractSection(content, sectionName) {
  // 简单实现：尝试提取对应章节，找不到则返回待补充标记
  const regex = new RegExp(`## ${sectionName}[\\s\\S]*?(?=## |$)`, 'i');
  const match = content.match(regex);
  return match ? match[0].replace(`## ${sectionName}`, '').trim() : '（待补充）';
}

function mergeContent(existing, newContent) {
  // 结构化合并
  const sections = ['核心概念', '要点总结', '代码示例', '易错点'];
  let merged = existing;
  
  for (const section of sections) {
    const newSection = extractSection(newContent, section);
    const existingSection = extractSection(existing, section);
    
    if (newSection && newSection !== '（待补充）') {
      // 去重合并逻辑
      const combined = deduplicateMerge(existingSection, newSection, section);
      merged = replaceSection(merged, section, combined);
    }
  }
  
  // 更新时间戳
  merged = merged.replace(
    /\*最后更新：[^*]+\*/,
    `*最后更新：${new Date().toLocaleDateString('zh-CN')}*`
  );
  
  return merged;
}

function deduplicateMerge(existing, newContent, sectionType) {
  // 简单的去重：按行比较，保留不重复的行
  const existingLines = existing.split('\n').map(l => l.trim()).filter(l => l);
  const newLines = newContent.split('\n').map(l => l.trim()).filter(l => l);
  
  const result = [...existingLines];
  
  for (const line of newLines) {
    // 检查是否已存在（忽略编号和格式符号）
    const normalized = line.replace(/^[-*\d.\s]+/, '').toLowerCase();
    const exists = existingLines.some(el => 
      el.replace(/^[-*\d.\s]+/, '').toLowerCase() === normalized
    );
    if (!exists && normalized.length > 5) {
      result.push(line);
    }
  }
  
  // 重新编号（针对要点总结和易错点）
  if (sectionType === '要点总结' || sectionType === '易错点') {
    return result.map((line, idx) => {
      const clean = line.replace(/^[-*\d.\s]+/, '');
      return `${idx + 1}. ${clean}`;
    }).join('\n');
  }
  
  return result.join('\n');
}

function replaceSection(content, sectionName, newSection) {
  const regex = new RegExp(`(## ${sectionName}[\\s\\S]*?)(?=## |$)`, 'i');
  return content.replace(regex, `## ${sectionName}\n${newSection}\n\n`);
}

function selfReview(topic, content) {
  const issues = [];
  
  // 检查内容长度
  if (content.length < 200) {
    issues.push('内容过短');
  }
  
  // 检查核心概念
  if (!content.includes('## 核心概念') || content.includes('（待补充）')) {
    issues.push('缺少核心概念');
  }
  
  // 检查待补充标记
  const todoMatches = content.match(/（待补充）|TODO|todo/g);
  if (todoMatches) {
    issues.push(`存在 ${todoMatches.length} 处待补充标记`);
  }
  
  // 检查代码块格式
  const codeBlocks = content.match(/\`\`\`[\s\S]*?\`\`\`/g);
  if (codeBlocks) {
    for (const block of codeBlocks) {
      if (!block.match(/\`\`\`[a-z]*\n[\s\S]*?\`\`\`/)) {
        issues.push('代码块格式可能不完整');
        break;
      }
    }
  }
  
  return {
    summary: issues.length === 0 ? '✅ 基础检查通过' : `⚠️ ${issues.join('、')}`,
    issues
  };
}

function getTargetPath(topic) {
  const category = getCategory(topic);
  const filename = sanitizeFilename(topic) + '.md';
  return `${category}/${filename}`;
}

function getCategory(topic) {
  const lower = topic.toLowerCase();
  
  if (lower.includes('jvm') || lower.includes('java') || lower.includes('spring') || 
      lower.includes('并发') || lower.includes('多线程') || lower.includes('集合')) {
    return 'java';
  }
  if (lower.includes('mysql') || lower.includes('sql') || lower.includes('数据库') || 
      lower.includes('索引') || lower.includes('事务')) {
    return 'mysql';
  }
  if (lower.includes('redis') || lower.includes('缓存')) {
    return 'redis';
  }
  if (lower.includes('kafka') || lower.includes('mq') || lower.includes('消息队列')) {
    return 'mq';
  }
  if (lower.includes('linux') || lower.includes('操作系统')) {
    return 'os';
  }
  if (lower.includes('网络') || lower.includes('tcp') || lower.includes('http')) {
    return 'network';
  }
  if (lower.includes('算法') || lower.includes('数据结构')) {
    return 'algorithm';
  }
  
  return 'misc';
}

function sanitizeFilename(name) {
  return name.replace(/[^\w\u4e00-\u9fa5]/g, '-').replace(/-+/g, '-').substring(0, 50);
}

function buildPRBody(topic, filePath, isUpdate, mergeInfo, review, topicSource) {
  return `## ${isUpdate ? '更新' : '添加'}笔记：${topic}

### 变更内容
- ${isUpdate ? '更新' : '新增'} ${filePath}${mergeInfo}
- 主题来源：${topicSource}

### 自检结果
${review.summary}

### 笔记摘要
- 主题：${topic}
- 分类：${getCategory(topic)}
- 时间：${new Date().toLocaleString('zh-CN')}`;
}

// 导出
module.exports = {
  generateSummary,
  saveNotes,
  searchNotes,
  reviewNotes
};
