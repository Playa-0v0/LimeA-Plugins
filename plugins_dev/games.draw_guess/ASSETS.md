# 素材说明

`assets/icon.svg` 为本插件制作的几何画笔图标，`assets/icon.png` 为其 192×192 的分发版本，均按本目录 MIT 许可证提供。

## 音效

以下素材由原作者按 [CC0 1.0（公共领域贡献声明）](https://creativecommons.org/publicdomain/zero/1.0/) 发布，允许修改和随插件分发。它们的授权独立于插件源码的 MIT 许可证。保留来源以便追溯，不表示原作者认可本插件。

| 本插件文件                | 来源与作者                                                                                                                                                   | 本地处理                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| `assets/audio/pencil.ogg` | [Pencil Sounds](https://opengameart.org/content/pencil-sounds)，AntumDeluge 整理；原始 `pencil_write` 为 [NachtmahrTV](https://freesound.org/s/571800/) 制作 | 去除静音、截为 1.1 秒、淡入淡出 |
| `assets/audio/erase.ogg`  | 同上；原始 `pencil_erase` 为 [damsur](https://freesound.org/s/443241/) 制作                                                                                  | 截为 0.22 秒、淡入淡出          |
| `assets/audio/fill.ogg`   | [40 CC0 water / splash / slime SFX](https://opengameart.org/content/40-cc0-water-splash-slime-sfx)，rubberduck，`bubble_02.ogg`                              | 淡入淡出                        |
| `assets/audio/undo.ogg`   | [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds)，Kenney，`back_001`                                                                     | 转码                            |
| `assets/audio/redo.ogg`   | 同上，`click_002`                                                                                                                                            | 转码                            |

Kenney 原始音频通过 [Calinou 的公开 WAV 镜像](https://github.com/Calinou/kenney-interface-sounds) 获取，镜像保留了 [CC0 许可声明](https://github.com/Calinou/kenney-interface-sounds/blob/master/LICENSE.txt)。本插件音效统一使用 Ogg Vorbis（音频压缩格式），单声道、24 kHz，五个文件共 26,333 字节；播放前从本地插件资源读取，不依赖在线音效服务。

画笔素材包附带的来源说明：

```text
Writing & erasing pencil sounds.

Licensing: Creative Commons Zero (CC0)

Sources:
- pencil_erase by damsur: https://freesound.org/s/443241/
- pencil_write by NachtmahrTV: https://freesound.org/s/571800/
```

画板由 LimeA 提供，插件安装包不重复分发绘图库。模型生成的词条与用户画作属于运行数据，不包含在安装包中。
