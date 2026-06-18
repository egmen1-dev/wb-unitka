import { PROMPT_VERSION } from './feedback-manager-prompt.js';

export function readCommitSha() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || '';
  return sha ? sha.slice(0, 7) : 'local';
}

export function getDeployMeta() {
  return {
    promptVersion: PROMPT_VERSION,
    commitSha: readCommitSha(),
    managerPromptOnly: true,
  };
}
