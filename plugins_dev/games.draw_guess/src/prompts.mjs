const object = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const text = (maxLength) => ({ type: 'string', maxLength });
export const wordsSchema = object({
  words: {
    type: 'array',
    minItems: 6,
    maxItems: 18,
    items: object({
      word: { ...text(8), minLength: 1 },
      aliases: { type: 'array', maxItems: 4, items: text(12) },
    }),
  },
});
export const choiceSchema = object({ choice: { type: 'integer', minimum: 1, maximum: 3 } });
export const guessSchema = object({ guess: text(24) });
const number = (max) => ({ type: 'number', minimum: 0, maximum: max });
const color = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' };
export const drawSchema = object({
  add: {
    type: 'array',
    maxItems: 24,
    items: object({
      kind: { type: 'string', enum: ['line', 'ellipse', 'rectangle'] },
      x: number(800),
      y: number(600),
      width: number(800),
      height: number(600),
      points: { type: 'array', maxItems: 400, items: number(800) },
      color,
      fill: { type: 'string', pattern: '^(#[0-9a-fA-F]{6}|transparent)$' },
      strokeWidth: { type: 'number', minimum: 1, maximum: 24 },
    }),
  },
  remove: { type: 'array', maxItems: 24, items: text(64) },
  done: { type: 'boolean' },
});
export const wordPrompt = (used) =>
  `你是你画我猜的独立出题员，不参与猜画。生成12个适合简笔画的常见、具体中文名词，每个1至6字，覆盖物品、动物、食物或自然事物。不要长句、生僻名称、文字谜语、抽象概念。每个词可附少量确切同义词，不能用宽泛类别作同义词。避免这些已经展示过的词：${JSON.stringify(used)}。只提交words结构化结果。`;
export const choicePrompt = (choices) =>
  `你是本轮画家，用户负责猜。秘密候选：${JSON.stringify(choices.map((v) => v.word))}。选择你想画的一个，返回choice（1到3），不说出题目。`;
export const guessPrompt = (guesses, characterCount) =>
  `你正和用户玩你画我猜。你是猜测者，用户是画家。只观察所附实际画面，不知道题目。字数提示：标准题目共${characterCount}个字。请结合字数猜一个最可能的具体中文名词；确切同义词字数可以不同；信息不足可返回空guess。不要描述答案来自系统或编造看到的细节。不重复已猜过的：${JSON.stringify(guesses.map((v) => v.text))}。`;
export const drawPrompt = (state) =>
  `你正和用户玩你画我猜，你是画家。私密题目：${state.answer.word}。不要写出任何文字、字母或数字提示答案。白色画板800×600，原点左上，x向右y向下。看所附的实际画面，决定下一批绘画；抽象和笨拙也没关系。用基础图形表达，先画轮廓，再补细节。line的points为绝对坐标[x,y,x,y,...]，此时x/y/width/height填0；ellipse和rectangle用左上角x/y及width/height，points填[]。fill用transparent或六位十六进制颜色，strokeWidth为1到24。可remove已有元素，再add替代它。已有元素：${JSON.stringify(state.scene.shapes)}。用户猜过：${JSON.stringify(state.guesses.map((v) => v.text))}。${state.drawingError ?? ''} 返回add、remove、done；画得够了就done=true等待用户，无需不断重复添加。`;
export const normalize = (value) =>
  String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
export const wordLength = (word) => [...normalize(word)].length;
export function validWords(value, used) {
  const seen = new Set(used.map(normalize));
  return value.words
    .filter((item) => {
      const word = normalize(item.word);
      if (!word || [...word].length > 6 || seen.has(word)) return false;
      seen.add(word);
      return true;
    })
    .map((item) => ({ word: item.word.trim(), aliases: item.aliases.filter((s) => normalize(s)) }));
}
