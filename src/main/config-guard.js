// 配置安全检查 —— 检测疑似占位密钥，防止误写入

function isSensitiveConfigKeyName(keyName) {
  if (typeof keyName !== 'string' || !keyName) return false;
  return /(?:api[_-]?key|bot[_-]?token|app[_-]?token|app[_-]?secret|client[_-]?secret|signing[_-]?secret|token|secret|password)$/i.test(keyName);
}

function isLikelyMaskedSecret(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (!text) return false;
  if (text === '__OPENCLAW_REDACTED__') return true;
  if (/^sk-[xX*._-]{6,}$/.test(text)) return true;
  if (/x{6,}/i.test(text) || /\*{6,}/.test(text)) return true;
  if (/^[A-Za-z0-9_-]+\.{3}[A-Za-z0-9_-]+$/.test(text)) return true;
  if (/(?:replace|placeholder|dummy|example|your)[-_ ]*(?:api)?[-_ ]*(?:key|token|secret)/i.test(text)) return true;
  return false;
}

function collectMaskedSecretPaths(value, pathParts = [], result = []) {
  if (result.length >= 8) return result;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectMaskedSecretPaths(item, [...pathParts, String(index)], result);
    });
    return result;
  }
  if (!value || typeof value !== 'object') return result;

  for (const [key, val] of Object.entries(value)) {
    const nextPath = [...pathParts, key];
    if (isSensitiveConfigKeyName(key)) {
      if (typeof val === 'string' && isLikelyMaskedSecret(val)) {
        result.push(nextPath.join('.'));
      } else if (Array.isArray(val)) {
        val.forEach((item, index) => {
          if (typeof item === 'string' && isLikelyMaskedSecret(item)) {
            result.push([...nextPath, String(index)].join('.'));
          }
        });
      }
      continue;
    }
    if (val && typeof val === 'object') {
      collectMaskedSecretPaths(val, nextPath, result);
    }
    if (result.length >= 8) break;
  }
  return result;
}

module.exports = {
  isSensitiveConfigKeyName,
  isLikelyMaskedSecret,
  collectMaskedSecretPaths,
};
