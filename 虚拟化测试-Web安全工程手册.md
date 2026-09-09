# Web 安全工程实践手册（长文档虚拟化测试）

> 本文档用于测试长文档预览渲染：请核对 1~8 章全部渲染、脚注区显示、滚动到底部可见"文档结束"标记。

Web 安全是工程实践中最容易低估的领域。据统计，超过半数的 Web 漏洞源于对输入输出边界处理的疏忽[^owasp-top10]。本文手册系统整理常见攻击面的防御工程实践，涵盖 XSS、CSRF、SQL 注入、认证会话、传输安全、安全响应头与依赖供应链七个主题。

本文的防御建议以"默认安全"为出发点：即框架与中间件应当在默认配置下就是安全的，需要开发者显式选择关闭防护，而不是相反。这一原则被称为 secure by default[^secure-by-default]，它是现代框架设计的重要基石。

## 1. 跨站脚本攻击（XSS）

### 1.1 攻击类型概览

XSS 是指攻击者将恶意脚本注入到受害者浏览的页面中执行[^owasp-top10]。按照注入路径的不同，可分为三类：

| 类型 | 注入路径 | 典型场景 | 危害等级 |
|---|---|---|---|
| 反射型 XSS | 请求参数直接回显 | 搜索结果页回显关键词 | 中 |
| 存储型 XSS | 恶意数据被持久化后展示 | 评论区、个人签名 | 高 |
| DOM 型 XSS | 前端脚本解析不可信数据 | `innerHTML` 写入 URL 片段 | 高 |
| 突变型 XSS | 浏览器解析上下文差异 | 字符集混淆、命名空间混淆 | 中 |

三类攻击的共同根源是**不可信数据跨越了信任边界而没有经过恰当编码**。理解这一点比记忆具体攻击载荷更重要，因为编码上下文（HTML、属性、JS、URL）决定了转义规则[^contextual-encoding]。

### 1.2 输出编码

不同上下文需要不同的编码函数，以下是一个典型的上下文感知编码实现：

```javascript
// contextual-encoding.js
const HTML_ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function encodeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ENTITIES[ch]);
}

function encodeJsString(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function encodeUrlComponent(value) {
  return encodeURIComponent(String(value));
}

// 按上下文分派：模板渲染时必须明确目标上下文
function encodeFor(context, value) {
  switch (context) {
    case 'html': return encodeHtml(value);
    case 'js':   return encodeJsString(value);
    case 'url':  return encodeUrlComponent(value);
    case 'attr': return encodeHtml(value); // 属性值默认 HTML 编码 + 引号包裹
    default:
      throw new Error(`Unknown encoding context: ${context}`);
  }
}

module.exports = { encodeFor };
```

### 1.3 React / 现代框架中的 XSS

现代框架默认对所有插值做转义，危险点集中在少数"逃生舱"API：

| API | 风险 | 安全替代 |
|---|---|---|
| `dangerouslySetInnerHTML` | 直接注入 HTML | DOMPurify 清洗后再注入 |
| `href="javascript:..."` | 协议注入 | 协议白名单校验 |
| `eval` / `new Function` | 动态执行 | `JSON.parse`、显式逻辑 |
| `document.write` | 解析期注入 | DOM API 操作 |
| Markdown 渲染 | 原始 HTML 混入 | 限制 schema + 限制协议 |

### 1.4 内容安全策略（CSP）

CSP 通过响应头声明资源加载白名单，是 XSS 的纵深防御层[^csp3]。推荐从 `Content-Security-Policy-Report-Only` 起步：

```nginx
# csp.conf —— 逐步收紧的白名单策略
add_header Content-Security-Policy-Report-Only "\
  default-src 'self'; \
  script-src 'self' 'nonce-{RANDOM}'; \
  style-src 'self'; \
  img-src 'self' data: https:; \
  font-src 'self'; \
  connect-src 'self' https://api.example.com; \
  frame-ancestors 'none'; \
  base-uri 'none'; \
  form-action 'self'; \
  object-src 'none'; \
  report-uri /csp-report;" always;
```

## 2. 跨站请求伪造（CSRF）

### 2.1 攻击原理

CSRF 利用浏览器自动携带 Cookie 的特性，诱导已登录用户的浏览器发起非本意的请求[^rfc6265]。攻击成立需要三个条件：受害者已登录、请求有副作用、服务端仅凭 Cookie 鉴权。

### 2.2 防御方案对比

| 防御方案 | 实现成本 | 兼容性 | 有效性 | 备注 |
|---|---|---|---|---|
| Synchronizer Token | 中 | 全部 | 高 | 表单隐藏字段携带随机 token |
| Double Submit Cookie | 低 | 全部 | 中高 | Cookie 与请求体双重比对 |
| SameSite Cookie | 极低 | 现代浏览器 | 高 | 首选基线措施[^samesite] |
| Origin/Referer 校验 | 低 | 全部 | 中 | 作为辅助校验 |
| 自定义请求头 | 低 | SPA 场景 | 高 | 如 `X-Requested-With` |
| 二次确认（密码/验证码） | 高 | 全部 | 高 | 敏感操作专用 |

### 2.3 组合防御实践

现代实践推荐 **SameSite=Lax 作为基线 + Token 作为增强**，以下为服务端中间件示例：

```typescript
// csrf-middleware.ts
import { randomBytes, timingSafeEqual } from 'node:crypto';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfProtect(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const cookieToken = req.cookies?.['csrf-token'];
  const headerToken = req.header('x-csrf-token');

  if (!cookieToken || !headerToken) {
    return res.status(403).json({ error: 'CSRF token missing' });
  }

  const a = Buffer.from(cookieToken);
  const b = Buffer.from(headerToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return res.status(403).json({ error: 'CSRF token mismatch' });
  }
  next();
}

export function issueCsrfToken(res) {
  const token = randomBytes(32).toString('base64url');
  res.cookie('csrf-token', token, {
    sameSite: 'lax',       // 基线防护
    httpOnly: false,        // 前端需读取后放入请求头
    secure: true,
    path: '/',
  });
  return token;
}
```

> 注意 `timingSafeEqual` 的使用：普通字符串比较存在时序侧信道，攻击者可逐字节猜测 token[^timing-attack]。

## 3. SQL 注入

### 3.1 漏洞成因与参数化查询

SQL 注入的本质是将不可信数据当作 SQL 指令的一部分执行。防御核心只有一条：**数据与指令永远分离**，即参数化查询。

```rust
// vulnerable vs safe —— Rust sqlx 示例
use sqlx::PgPool;

// ❌ 错误：拼接 SQL，攻击者输入 ' OR '1'='1 可绕过条件
pub async fn find_user_vulnerable(
    pool: &PgPool,
    name: &str,
) -> sqlx::Result<Vec<Row>> {
    let sql = format!("SELECT * FROM users WHERE name = '{}'", name);
    sqlx::fetch_all(&sql, pool).await
}

// ✅ 正确：绑定参数，驱动负责安全转义
pub async fn find_user_safe(
    pool: &PgPool,
    name: &str,
) -> sqlx::Result<Vec<Row>> {
    sqlx::query_as::<_, Row>(
        "SELECT id, name, email, created_at FROM users WHERE name = $1",
    )
    .bind(name)
    .fetch_all(pool)
    .await
}

// ✅ 动态场景：白名单约束标识符，值仍走参数绑定
pub async fn find_users_ordered_by(
    pool: &PgPool,
    column: &str,
    direction: &str,
) -> sqlx::Result<Vec<Row>> {
    const ALLOWED_COLUMNS: &[&str] = &["created_at", "name", "email"];
    const ALLOWED_DIRECTIONS: &[&str] = &["ASC", "DESC"];

    let col = ALLOWED_COLUMNS
        .iter()
        .find(|c| *c == column)
        .ok_or(Error::InvalidColumn)?;
    let dir = ALLOWED_DIRECTIONS
        .iter()
        .find(|d| *d == direction)
        .ok_or(Error::InvalidDirection)?;

    let sql = format!(
        "SELECT id, name FROM users ORDER BY {} {} LIMIT 100",
        col, dir
    );
    sqlx::fetch_all(sql.as_str(), pool).await
}
```

### 3.2 各类数据库参数化支持

| 技术栈 | 参数化 API | 占位符 | 动态标识符处理 |
|---|---|---|---|
| PostgreSQL / sqlx | `query().bind()` | `$1, $2` | 白名单校验 |
| MySQL | PreparedStatement | `?` | 白名单校验 |
| SQLite | `sqlite3` stmt | `?` / `:name` | 白名单校验 |
| Sequelize | `query(replacements)` | `:name` / `?` | `col` 白名单 |
| TypeORM | `getRepository().find()` | 自动 | `orderBy` 白名单 |

### 3.3 二阶注入与存储过程

二阶注入（second-order injection）指恶意数据先被安全存入数据库，随后在另一条查询中被不安全地拼接使用。这类漏洞无法靠入口校验发现，只能靠**全链路参数化**根治。

## 4. 认证与会话管理

### 4.1 密码存储

密码必须使用专用的慢哈希函数，禁止 MD5/SHA1/SHA256 裸哈希[^argon2]：

| 算法 | 类型 | 内存占用 | 抗 GPU/ASIC | 推荐参数（2024 基线） |
|---|---|---|---|---|
| Argon2id | 内存困难型 | 19 MiB+ | 强 | m=19456, t=2, p=1 |
| bcrypt | 计算困难型 | ~4 KiB | 中 | cost=12 |
| scrypt | 内存困难型 | 可调 | 强 | N=2^17, r=8, p=1 |
| PBKDF2 | 迭代型 | 低 | 弱 | 迭代 600000 起 |
| MD5/SHA1 | 通用哈希 | — | 无 | **禁止使用** |

```javascript
// password-hashing.js —— Argon2id 实践
const argon2 = require('argon2');

const OPTIONS = {
  type: argon2.argon2id, // 混合抗侧信道与抗 GPU
  memoryCost: 19456,     // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

async function hashPassword(plain) {
  return argon2.hash(plain, OPTIONS);
}

async function verifyPassword(digest, plain) {
  try {
    return await argon2.verify(digest, plain);
  } catch {
    return false; // 摘要格式损坏也返回 false，避免 500 泄漏信息
  }
}
```

### 4.2 会话标识符

会话 ID 必须由密码学安全随机源生成，至少 128 位熵：

```bash
# 生成 256 位熵的会话 ID（base64url 编码）
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

# 输出示例：Qm3Xk7Pz2vN9rTtLwYh5dJ8cF4aS1eU6iO0pG7nBqRk
```

会话固定攻击（session fixation）的防御要点：**任何权限提升后必须重置会话 ID**，包括登录、提权、切换角色。

### 4.3 Cookie 属性清单

| 属性 | 作用 | 推荐值 |
|---|---|---|
| `HttpOnly` | 禁止 JS 读取 | 会话 Cookie 必设 |
| `Secure` | 仅 HTTPS 传输 | 必设 |
| `SameSite` | 跨站发送策略 | `Lax` 或 `Strict` |
| `Domain` | 作用域 | 不设置（host-only） |
| `Path` | 路径作用域 | 最小必要路径 |
| `Max-Age` | 生命周期 | 敏感操作短时效 |

## 5. 传输安全

### 5.1 TLS 配置基线

```nginx
# tls-modern.conf —— Mozilla Intermediate 兼容配置
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
ssl_prefer_server_ciphers off;
ssl_session_timeout 1d;
ssl_session_cache shared:SSL:10m;
ssl_session_tickets off;
ssl_stapling on;
ssl_stapling_verify on;

# TLS 1.3 专属（nginx 1.23+）
ssl_conf_command Ciphersuites TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256;
```

### 5.2 各协议版本状态

| 协议 | 状态 | 说明 |
|---|---|---|
| TLS 1.3 | 推荐使用 | 0-RTT 注意重放风险 |
| TLS 1.2 | 兼容保留 | 需配 AEAD 套件 |
| TLS 1.0/1.1 | 禁用 | 已废弃（RFC 8996）[^rfc8996] |
| SSLv3 及以下 | 禁用 | POODLE 等致命漏洞 |

## 6. 安全响应头

完整的安全响应头集合及其作用域：

| 响应头 | 作用 | 推荐值 |
|---|---|---|
| `Strict-Transport-Security` | 强制 HTTPS | `max-age=63072000; includeSubDomains; preload` |
| `X-Content-Type-Options` | 禁止 MIME 嗅探 | `nosniff` |
| `X-Frame-Options` | 控制框架嵌入 | `DENY`（或用 CSP `frame-ancestors`） |
| `Referrer-Policy` | 控制 Referrer 泄漏 | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | 控制敏感 API | 按需禁用摄像头/地理位置等 |
| `Cross-Origin-Opener-Policy` | 隔离跨源窗口 | `same-origin` |
| `Cross-Origin-Resource-Policy` | 控制资源被引用 | `same-origin` 或 `same-site` |
| `Cache-Control` | 敏感数据防缓存 | `no-store` |

## 7. 依赖供应链安全

### 7.1 风险面

供应链攻击通过依赖投毒间接侵入应用，典型向量包括：typosquatting 包名、install 脚本投毒、维护者账号劫持、构建产物篡改。

```bash
# 审计与锁定
npm audit --audit-level=high        # 高危及以上直接失败
npm ci                               # 严格按 lockfile 安装（禁止改写）
npm ls --depth=0                     # 检查直接依赖树
node -e "console.log(process.versions)"  # 运行时版本基线

# 可选：提交前校验 lockfile 与 manifest 一致性
npx lockfile-lint --path package-lock.json \
  --allowed-hosts npm --validate-https
```

### 7.2 治理策略

| 策略 | 工具示例 | 阈值建议 |
|---|---|---|
| 高危漏洞阻断 | `npm audit` / OSV-Scanner | high 及以上阻断 |
| 新增依赖评审 | CODEOWNERS + PR 模板 | 安全团队会签 |
| 锁定文件校验 | lockfile-lint | CI 强制 |
| 定期升级 | Renovate / Dependabot | 每周批次 |
| 最小化安装脚本 | `--ignore-scripts` | 构建环境默认开启 |
| 私有源代理 | Verdaccio / Artifactory | 只代理白名单 scope |

## 8. 安全监控与响应

### 8.1 关键日志字段

安全事件的取证质量取决于日志的完备程度。以下字段建议在网关层统一采集：

| 字段 | 采集点 | 用途 |
|---|---|---|
| `request_id` | 网关生成 | 全链路串联 |
| `src_ip` / `x_forwarded_for` | 反代 | 攻击源定位 |
| `user_agent` | 网关 | 指纹识别 |
| `route` + `method` | 网关 | 热点攻击面 |
| `status` + `latency_ms` | 应用 | 异常模式检测 |
| `actor_id`（脱敏后） | 应用 | 影响面评估 |
| `csp_report` | 浏览器 | XSS 尝试捕获 |

### 8.2 告警分级

```text
P0 立即响应（<15min）：确认中的 RCE / 认证绕过 / 数据外泄
P1 小时级响应：在野利用的高危依赖漏洞 / 权限提升
P2 当日响应：高危但无利用证据的漏洞
P3 例行处理：中低危 / 加固建议
```

---
[^owasp-top10]: OWASP Foundation. *OWASP Top 10:2021*. https://owasp.org/Top10/

## 附录

- OWASP Top 10 Web Application Security Risks[^owasp-top10]
- RFC 6265: HTTP State Management Mechanism[^rfc6265]
- RFC 8996: Deprecating TLS 1.0 and TLS 1.1[^rfc8996]
- W3C Content Security Policy Level 3[^csp3]
- RFC 9107: Argon2 Memory-Hard Function[^argon2]
- OWASP CSRF Prevention Cheat Sheet[^csrf-cheatsheet]
- OWASP Secure Headers Project[^secure-headers]
- Timing Side-Channel Attacks[^timing-attack]


[^owasp-top10]: OWASP Foundation. *OWASP Top 10:2021*. https://owasp.org/Top10/
[^secure-by-default]: 默认安全原则要求系统在默认配置下即具备基线防护。
[^contextual-encoding]: OWASP XSS Prevention Cheat Sheet 对 HTML Body、属性、JS、CSS、URL 五类上下文分别给出了编码规则。
[^csp3]: W3C. *Content Security Policy Level 3*. https://www.w3.org/TR/CSP3/
[^rfc6265]: Barth, A. *RFC 6265: HTTP State Management Mechanism*. IETF, 2011.
[^samesite]: `SameSite=Lax` 允许顶级导航携带 Cookie 但阻止跨站 POST 等子资源请求携带。
[^timing-attack]: 时序攻击通过测量比较操作的耗时逐位猜测秘密值。
[^argon2]: Biryukov, A. et al. *RFC 9107: Argon2 Memory-Hard Function*. IETF, 2021.
[^rfc8996]: Moriarty, K., Farrell, S. *RFC 8996: Deprecating TLS 1.0 and TLS 1.1*. IETF, 2021.
[^csrf-cheatsheet]: OWASP. *CSRF Prevention Cheat Sheet*. https://cheatsheetseries.owasp.org/
[^secure-headers]: OWASP. *Secure Headers Project*. https://owasp.org/www-project-secure-headers/

---

**文档结束** —— 共 8 章 + 附录 + 11 脚注。若你在预览中看到此行，说明文档已渲染到底部。