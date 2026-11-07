export const zh = {
  accountTitle: 'GitHub 账号', featuresTitle: 'GitHub 功能',
  features: [
    ['仓库和代码', '查找仓库、读取文件与提交，创建分支并更新仓库内容。'],
    ['议题和拉取请求', '创建和更新议题，评论、审查及合并拉取请求。'],
    ['发布和自动化运行', '查看和创建发布，触发、重跑或取消自动化运行。'],
  ],
  connect: '连接 GitHub', continue: '打开授权页面', cancel: '取消授权', refresh: '刷新连接', disconnect: '断开连接', retry: '重试',
  install: '管理授权仓库', manage: '管理 GitHub 授权',
  deviceHint: '请在打开的 GitHub 页面输入以下验证码，并确认连接 LimeA Connector。',
  loading: '正在读取账号…', loadFailed: '无法读取连接状态。', notConnected: '尚未连接 GitHub', ready: '已连接',
  scope: '访问安装 LimeA Connector 时选定的仓库', reauthorization: '授权已失效，请断开并重新连接。',
  authorizing: '等待 GitHub 授权', authorizingHint: '在浏览器完成授权后，账号会自动显示在这里。',
  actionFailed: '操作未完成，请检查网络后重试。', vaultUnavailable: '系统凭据存储不可用。', refreshUnavailable: '无法刷新授权，请重新连接。',
  refreshPending: '正在刷新授权…', revokePending: '正在处理授权…', savedAcknowledging: '账号已保存。', recoveryHint: '上次授权操作未完成，请断开并重新连接。',
  auth: { failed: '授权失败，请重新连接。', expired: '验证码已过期，请重新连接。', unknown: '授权结果未知，请重新连接。', cancelled: '已取消授权。' },
  revocation: { not_requested: '已断开本机连接。', pending: '已断开本机连接。', confirmed: '已断开连接。', unknown: '已移除本机凭据。可点击「管理 GitHub 授权」撤销 GitHub 端的授权。', failed: '已移除本机凭据，请到 GitHub 核对授权。' },
};
export const en = {
  accountTitle: 'GitHub account', featuresTitle: 'GitHub tools',
  features: [['Repositories and code', 'Find repositories, read files and commits, create branches and update contents.'], ['Issues and pull requests', 'Create and update issues, comment, review and merge pull requests.'], ['Releases and workflow runs', 'Read and create releases, dispatch, rerun or cancel workflows.']],
  connect: 'Connect GitHub', continue: 'Open authorization', cancel: 'Cancel', refresh: 'Refresh connection', disconnect: 'Disconnect', retry: 'Retry', install: 'Manage repositories', manage: 'Manage GitHub access',
  deviceHint: 'Enter this code on GitHub and confirm that you are connecting LimeA Connector.',
  loading: 'Loading account…', loadFailed: 'Could not load connection.', notConnected: 'GitHub is disconnected', ready: 'Connected', scope: 'Repositories selected for LimeA Connector', reauthorization: 'Authorization expired. Disconnect and reconnect.',
  authorizing: 'Waiting for GitHub', authorizingHint: 'Complete authorization in your browser. Your account will appear here automatically.', actionFailed: 'Operation failed. Check your connection and retry.', vaultUnavailable: 'System credential storage is unavailable.', refreshUnavailable: 'Reconnect to renew authorization.', refreshPending: 'Refreshing authorization…', revokePending: 'Processing authorization…', savedAcknowledging: 'Account saved.', recoveryHint: 'Authorization did not complete. Disconnect and reconnect.',
  auth: { failed: 'Authorization failed. Reconnect.', expired: 'Code expired. Reconnect.', unknown: 'Authorization outcome unknown. Reconnect.', cancelled: 'Authorization cancelled.' },
  revocation: { not_requested: 'Local connection removed.', pending: 'Local connection removed.', confirmed: 'Disconnected.', unknown: 'Local credentials removed. Use Manage GitHub access to revoke authorization on GitHub.', failed: 'Local credentials removed. Review authorization on GitHub.' },
};
