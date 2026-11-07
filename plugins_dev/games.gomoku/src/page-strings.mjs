export const zh = {
  introLabel: '五子棋能怎么玩',
  introRulesTitle: '标准规则：',
  introRulesDetail: '15×15 自由规则，无禁手，开局随机分配黑白，黑棋先行。',
  introTurnsTitle: '轮流落子：',
  introTurnsDetail: '你和角色交替，点击棋盘交点落子，也可以方向键移动、回车落子。',
  introEngineTitle: '模型或引擎：',
  introEngineDetail: '可选模型独立思考，或本地引擎给出候选点和评估，最终落子仍由模型决定。',
  introReplayTitle: '结束复盘：',
  introReplayDetail: '支持认输、再来一局、累计比分，也能查询最近五局的完整棋谱与结果。',
  featuresTitle: '插件功能',
  boardTitle: '开局与棋盘',
  boardDetail: '15×15 自由规则，随机黑白、黑棋先行；支持聊天入口和小游戏面板，满盘无人获胜判和。',
  turnsTitle: '轮流落子',
  turnsDetail:
    '你点击交点落子，方向键移动选择、回车确认；角色根据最新完整棋盘选择空点，用户回合保持等待，不请求模型。',
  winTitle: '胜负判定',
  winDetail:
    '横、竖或斜向连续五子或以上获胜，获胜连线高亮，最近一手标圆点；胜负以后台结果为准。',
  engineTitle: '模型落子与引擎辅助',
  engineDetail:
    '默认只向模型提供棋盘；可切换本地引擎，计算最多三个候选落点和评估分，模型仍可选择其他合法空点。引擎超时会使用已完成的较浅分析。',
  settingsTitle: '对局设置',
  settingsDetail:
    '可在插件卡片直接打开设置，选择模型落子或引擎辅助、普通或困难；设置保存在插件数据库，从下一局开始生效，暂停棋局沿用原设置。',
  pauseTitle: '暂停与恢复',
  pauseDetail:
    '停止运行、模型失败或重启会保留棋盘，点击「继续对局」恢复；同步失败时禁止操作，不自动补下棋子。',
  historyTitle: '对局记录',
  historyDetail:
    '每局结算或主动结束时归档，记录落子顺序、黑白归属、结果和比分；最近五局可按当前聊天查询，未完成的棋局不计输赢。',
  usageTitle: '开始使用',
  usage: '从聊天右侧打开「小游戏」，选中「五子棋」，点击「开始对局」；也可以直接让角色陪你下。你可以这样说：',
  usageExample: '陪我下一盘五子棋吧，你先走。',
};

export const en = {
  introLabel: 'How Gomoku works',
  introRulesTitle: 'Standard rules:',
  introRulesDetail:
    '15×15 freestyle Gomoku with no forbidden moves; colors are assigned randomly and black moves first.',
  introTurnsTitle: 'Take turns:',
  introTurnsDetail:
    'You and the character alternate; click an intersection, or use the arrow keys and Enter.',
  introEngineTitle: 'Model or engine:',
  introEngineDetail:
    'The model can think on its own, or a local engine can suggest candidate moves and scores; the final move is still the model’s choice.',
  introReplayTitle: 'Review afterwards:',
  introReplayDetail:
    'Resign, play again, keep score, and review the full moves and results of the last five rounds.',
  featuresTitle: 'Plugin features',
  boardTitle: 'Board and opening',
  boardDetail:
    '15×15 freestyle; random colors and black first. Opens from chat or Mini games; a full board with no winner is a draw.',
  turnsTitle: 'Alternating moves',
  turnsDetail:
    'Click an intersection to place a stone, or use the arrow keys and Enter. The character picks an empty point from the latest full board; your turn waits without model requests.',
  winTitle: 'Win detection',
  winDetail:
    'Five or more stones in a row horizontally, vertically or diagonally win; the winning line is highlighted and the last move is marked. The backend result is authoritative.',
  engineTitle: 'Model or engine assistance',
  engineDetail:
    'By default the model only receives the board. A local engine can compute up to three candidate moves and scores, while the model may still choose another legal point. A timeout falls back to the shallower completed analysis.',
  settingsTitle: 'Game settings',
  settingsDetail:
    'Open settings from the plugin card to choose model moves or engine assistance, and normal or hard difficulty. Settings are saved in the plugin database and apply from the next round; paused games keep their original settings.',
  pauseTitle: 'Pause and resume',
  pauseDetail:
    'Stopping the run, model failure or restart keeps the board; continue to resume. Failed synchronization blocks moves and never places stones automatically.',
  historyTitle: 'Match history',
  historyDetail:
    'Each completed or resigned round is archived with move order, colors, result and score. The last five rounds can be queried per chat; unfinished games do not count as wins or losses.',
  usageTitle: 'Start playing',
  usage:
    'Open Mini games from the right side of the chat, choose Gomoku and start a round, or ask the character to play. Try saying:',
  usageExample: 'Let’s play Gomoku. You go first.',
};
