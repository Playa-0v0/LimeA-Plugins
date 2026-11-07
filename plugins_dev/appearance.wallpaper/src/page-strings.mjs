export const zh = {
  introLabel: '壁纸与玻璃外观能做什么',
  introSourcesTitle: '多种来源：',
  introSourcesDetail: '本地图片、视频、Wallpaper Engine 的 project.json，或直接扫描 Steam 工坊库。',
  introLibraryTitle: '缩略图选择：',
  introLibraryDetail:
    '壁纸库用封面网格展示，宽窗口三列、窄窗口两列，标出名称、类型和已选项目。',
  introGlassTitle: '玻璃与压暗：',
  introGlassDetail: '玻璃开关控制模糊，滑动条调整工作区不透明度、壁纸压暗和外框加深。',
  introSafeTitle: '安全与恢复：',
  introSafeDetail:
    '媒体只通过回环地址和随机凭据提供，文件留在原位置；停用或清除后恢复原生外观。',
  featuresTitle: '插件功能',
  sourcesTitle: '壁纸来源',
  sourcesDetail:
    '支持本地图片、静音视频、Wallpaper Engine 项目的 project.json 和网页壁纸；不下载工坊内容，不启动应用程序类壁纸。',
  libraryTitle: '预览与选择',
  libraryDetail:
    '工坊项目优先读取 project.json 的 preview，本地图片使用自身缩略图；只加载可视区附近封面，最多两项请求，前端缓存 96 项。',
  glassTitle: '玻璃外观',
  glassDetail:
    '玻璃开关只控制模糊，关闭后仍显示壁纸并保留不透明度；可调工作区不透明度、模糊和壁纸压暗。',
  frameTitle: '外框加深',
  frameDetail:
    '只加深标题栏、左侧栏和四周留白，0%–80% 可调，默认 35%；不改变工作区内容区域。',
  playbackTitle: '播放控制',
  playbackDetail:
    '帧率可选 15/30/60，填充方式支持 cover、contain、stretch，也可以暂停播放；媒体默认静音，窗口隐藏时暂停。',
  securityTitle: '安全边界',
  securityDetail:
    '壁纸脚本运行在独立回环来源的受限框架中，不获得 LimeA 桌面桥接；媒体路径有随机凭据且只读，单文件选择不开放同目录其他文件。',
  stateTitle: '状态与恢复',
  stateDetail:
    '配置和壁纸列表存入宿主 SQLite，升级不重置；清除仅取消选择，不删除原文件。扫描失败或场景不兼容会在设置区提示。',
  pageSettingsTitle: '外观设置',
  settingsLoading: '正在读取外观设置…',
  pageSettingsDescription:
    '选择图片、视频或 Wallpaper Engine 项目的 project.json；也可以扫描 Steam 工坊库。选择后立即应用并自动保存。',
  settingsLoadFailed: '外观设置加载失败，请返回后重试。',
  usageTitle: '开始使用',
  usage:
    '在下方「外观设置」选择壁纸，再调整玻璃、模糊、压暗、外框和播放选项。所有改动自动保存，重启后恢复。',
  usageExample: '建议先选一张高分辨率图片，再调整工作区不透明度和模糊，看看实际效果。',
};

export const en = {
  introLabel: 'What Wallpaper & Glass can do',
  introSourcesTitle: 'Many sources:',
  introSourcesDetail:
    'Local images, videos, a Wallpaper Engine project.json, or a scan of your Steam workshop library.',
  introLibraryTitle: 'Pick from previews:',
  introLibraryDetail:
    'The wallpaper library uses a cover grid: three columns on wide windows, two on narrow ones, with name, type and selection marked.',
  introGlassTitle: 'Glass and dimming:',
  introGlassDetail:
    'The glass toggle controls blur; sliders adjust workspace opacity, wallpaper dimming and frame darkening.',
  introSafeTitle: 'Safe and reversible:',
  introSafeDetail:
    'Media is served over loopback with random credentials; files stay in place, and disabling or clearing restores the native background.',
  featuresTitle: 'Plugin features',
  sourcesTitle: 'Wallpaper sources',
  sourcesDetail:
    'Local images, muted videos, Wallpaper Engine project.json files and web wallpapers. It does not download workshop content or start application wallpapers.',
  libraryTitle: 'Previews and selection',
  libraryDetail:
    'Workshop projects prefer the preview in project.json, while local images use their own thumbnail. Only covers near the viewport load, at most two requests, with a 96-item client cache.',
  glassTitle: 'Glass appearance',
  glassDetail:
    'The glass toggle controls blur only; turning it off still shows the wallpaper and keeps the opacity setting. Workspace opacity, blur and wallpaper dimming are adjustable.',
  frameTitle: 'Darker window frame',
  frameDetail:
    'Darkens only the title bar, left sidebar and window insets, adjustable from 0% to 80% with a 35% default; the workspace content area is unchanged.',
  playbackTitle: 'Playback controls',
  playbackDetail:
    'Frame rate 15/30/60, fit cover, contain or stretch, and pause playback. Media is muted by default and pauses when the window is hidden.',
  securityTitle: 'Security boundary',
  securityDetail:
    'Wallpaper scripts run in a restricted frame on a separate loopback origin without the LimeA desktop bridge. Media paths use random read-only credentials, and a single-file choice does not expose its directory.',
  stateTitle: 'State and recovery',
  stateDetail:
    'Configuration and the wallpaper list are stored in host SQLite and survive upgrades; clearing only deselects and never deletes original files. Scan failures or incompatible scenes appear in settings.',
  pageSettingsTitle: 'Appearance settings',
  settingsLoading: 'Loading appearance settings…',
  pageSettingsDescription:
    'Choose an image, video, or Wallpaper Engine project.json, or scan your Steam workshop library. Changes apply immediately and save automatically.',
  settingsLoadFailed: 'Could not load appearance settings. Go back and try again.',
  usageTitle: 'Start using it',
  usage:
    'Pick a wallpaper in Appearance settings below, then adjust glass, blur, dimming, frame and playback options. Everything saves automatically and returns after a restart.',
  usageExample: 'Try a high-resolution image first, then tune workspace opacity and blur to see the effect.',
};
