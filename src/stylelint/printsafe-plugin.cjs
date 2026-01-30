// A tiny Stylelint plugin with print-focused warnings.
// - blocks remote url() (http/https)
// - warns on properties likely to cause rasterization or PDF weirdness in prepress
//
// Commonjs is intentional to keep Stylelint happy in more environments.

const stylelint = require("stylelint");

const ruleRemoteUrls = "printsafe/no-remote-urls";
const ruleRiskyProps = "printsafe/no-risky-print-effects";

const messages = stylelint.utils.ruleMessages(ruleRemoteUrls, {
  rejected: (url) => `Remote URL is not allowed in print CSS: ${url}`
});

const riskyMessages = stylelint.utils.ruleMessages(ruleRiskyProps, {
  rejected: (prop) => `Property is high-risk for print/PDF (can force rasterization): ${prop}`
});

function extractUrls(value) {
  const urls = [];
  const re = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
  let m;
  while ((m = re.exec(value))) urls.push(m[2]);
  return urls;
}

const riskyProperties = new Set([
  "filter",
  "backdrop-filter",
  "mix-blend-mode",
  "background-blend-mode",
  "isolation",
  "animation",
  "animation-name",
  "transition",
  "will-change",
  "clip-path"
]);

module.exports = stylelint.createPlugin(ruleRemoteUrls, function(primaryOption) {
  return function(root, result) {
    if (!primaryOption) return;
    root.walkDecls((decl) => {
      const urls = extractUrls(decl.value || "");
      for (const url of urls) {
        const lower = url.trim().toLowerCase();
        if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("//")) {
          stylelint.utils.report({
            message: messages.rejected(url),
            node: decl,
            result,
            ruleName: ruleRemoteUrls
          });
        }
      }
    });
    root.walkAtRules((at) => {
      const urls = extractUrls(at.params || "");
      for (const url of urls) {
        const lower = url.trim().toLowerCase();
        if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("//")) {
          stylelint.utils.report({
            message: messages.rejected(url),
            node: at,
            result,
            ruleName: ruleRemoteUrls
          });
        }
      }
    });
  };
});

module.exports.ruleRemoteUrls = ruleRemoteUrls;
module.exports.messagesRemoteUrls = messages;

module.exports.riskyRule = stylelint.createPlugin(ruleRiskyProps, function(primaryOption) {
  return function(root, result) {
    if (!primaryOption) return;
    root.walkDecls((decl) => {
      if (riskyProperties.has(decl.prop.toLowerCase())) {
        stylelint.utils.report({
          message: riskyMessages.rejected(decl.prop),
          node: decl,
          result,
          ruleName: ruleRiskyProps
        });
      }
    });
  };
});

module.exports.ruleRiskyProps = ruleRiskyProps;
module.exports.messagesRiskyProps = riskyMessages;
