# Excalidraw 场景

顶层写成：

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "https://excalidraw.com",
  "appState": {
    "viewBackgroundColor": "transparent",
    "theme": "light",
    "gridSize": 20
  },
  "files": {},
  "elements": []
}
```

以 `src/content/shorts/figures/transformer.excalidraw` 里同类型的一个元素为样板，改 `id`、位置、尺寸、文字和颜色。保留样板里的 `seed`、`version`、`versionNonce`、`index`、`updated`、`isDeleted`、`groupIds`、`frameId`、`link`、`locked`。`isDeleted` 保持 `false`。不要把已删除元素写进文件。

坐标落在 20 的网格上。`roughness` 用 `0`，`fillStyle` 用 `solid`，`opacity` 用 `100`。结构图不用手绘抖动。

矩形的 `type` 是 `rectangle`，写清 `x`、`y`、`width`、`height`。圆角沿用样板的 `"roundness": { "type": 3 }`。

文字的 `type` 是 `text`。`fontFamily` 用 `2`。标题字号约 22，正文约 16。`textAlign` 用 `center` 或 `left`。中文宽度按字号乘以字数估算，再加一截余量。高度约是字号的 1.25 倍。`containerId` 用 `null`，文字自己占一块。

箭头和线的 `points` 相对元素自己的 `x`、`y`。竖箭头写成 `[[0, 0], [0, 高度]]`，横线写成 `[[0, 0], [宽度, 0]]`。`startBinding` 和 `endBinding` 用 `null`，让终点落在目标边缘。绑错时箭头会离开框。

`id` 在这一张图里唯一，用英文短名，例如 `enc-frame`、`enc-label`。

阅读顺序从左到右，或从上到下。重复的层画一次，旁边标 `N×`。输入放在进入的一端，输出放在离开的一端。颜色有含义才用，并在正文里说这层颜色是什么。同一含义全篇用同一个色值。

样板里的主线是 `#1e1e1e`，次要线是 `#8a8175`，框线是 `#d3cdc2`。填充用很浅的颜色，让白底和浅灰底上都能分开。

改完后在浏览器里打开这篇，看默认缩放是否读得清，再切换亮色和暗色。
