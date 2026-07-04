// 双主题系统：工程主题「软体试验台」(lab，默认) 与生物主题「活体标本」(bio)。
// 主题只影响表现层——文案、配色、粒子、音效、脉搏调制；物理规则、相似度
// 与判定在两个主题下完全一致。lab 主题的 text/toasts 为空表：所有取值处都
// 以 `theme?.xxx ?? 原值` 兜底，因此 lab 下一切行为与无主题系统时逐位相同。
// 本模块必须能在无 localStorage 的 Node 测试环境下安全工作（兜底 lab）。

const STORAGE_KEY = 'polyform.theme';

export const THEMES = {
  lab: {
    meta: {
      id: 'lab',
      label: '软体试验台',
      title: '形变工坊',
      subtitle: 'PolyForm',
      tagline: '拉扯、切割、粘合一块物性未知的工程软材料——内部管路的材质，要靠你亲手试出来。',
      help: '操作：拖拽=抓取（最多 3 个控制点）· 双击=钉住/解除 · 切割须从软体外下刀 · 相似度达标并保持 3 秒即完成目标',
      tools: { pull: '🖐 牵拉', cut: '✂️ 切割', glue: '🔗 粘合' },
      pipesLabel: '管道',
    },
    palette: {},              // 空 = render2d 默认配色，逐位不变
    text: { levels: {} },     // 空 = 直接用关卡文件原文
    toasts: {},               // 空 = game.js 原文案
    strings: {},              // 空 = 会话层 hint 原文
    fx: { pulse: false, deflateStyle: 'air', debrisStyle: 'ceramic', sfx: 'industrial' },
  },

  bio: {
    meta: {
      id: 'bio',
      label: '活体标本',
      title: '活体标本',
      subtitle: 'PolyForm',
      tagline: '拉扯、切割、缝合一块活的组织：它体内脉管的性子，要靠你亲手摸出来。',
      help: '操作：拖拽=抓取（最多 3 个控制点）· 双击=钉住/解除 · 手术刀须从标本外下刀 · 相似度达标并保持 3 秒即完成目标',
      tools: { pull: '🖐 牵拉', cut: '🔪 手术刀', glue: '🪡 缝合' },
      pipesLabel: '脉管',
    },
    palette: {
      bodyFill: 'rgba(164,74,86,0.60)',
      bodyGlaze: 'rgba(164,74,86,0.20)',
      bodyStroke: '#f2a9b0',
      pipe: '#c98a94',
      pipeCasing: 'rgba(38,12,16,0.50)',
      pipeEnd: '#e2b3ba',
      highlight: '#ffe8dd',   // 湿润高光偏暖白
      body3d: '#a4545c',      // 3D 面基色（164,84,92 系）
      // bg/grid/ghost/grab/pin/cut/glue 不动；夹具银灰在 bio 语境读作解剖台
    },
    text: {
      levels: {
        L1: {
          name: '标本 01 · 软组织初检',
          intro: '先拖一拖，感受组织的弹性。双击可以把点钉住。',
          targets: [
            {
              name: '纺锤体',
              hint: '抓住左右两端往外拉；或者钉住一端，拖另一端。',
              moreHints: [
                '双击标本上的点可以钉住它。钉住左端，抓右端往外拉。',
                '跟着金色虚影走——它显示的就是目标位置。读数过线后保持 3 秒。',
              ],
            },
            {
              name: '月牙软骨',
              hint: '钉住一端，把另一端往下掰。里面的脉管会跟着组织一起变形。',
              moreHints: [
                '先钉住一端，抓另一端绕一个弧线拖下去。',
                '两端就位后，用第三个控制点把中段往上顶出月牙的弧顶。',
              ],
            },
          ],
        },
        L2: {
          name: '标本 02 · 充血腔室',
          intro: '这块组织鼓得很结实……里面那圈脉管是干什么的？',
          targets: [
            {
              name: '鼓胀的血囊',
              hint: '腔内的血压让它保持鼓胀——轻轻按两下就能凑出形状。',
              moreHints: [
                '抓住上下两侧往里按，把它压成横躺的凸壳。',
                '双击可以钉住一个点，腾出手来压另一边。',
              ],
            },
            {
              name: '放血后的软囊',
              hint: '怎么压都压不瘪？也许该请出手术刀。切断环状血管会放血泄压——下刀就回不了头了。',
              moreHints: [
                '它充着血，光靠按是压不瘪的。想想里面那圈血管是干什么的。',
                '换手术刀（按 2），从标本外面往里划一刀，切断里面那圈环形血管。',
                '放血之后：双击钉住左右两端，再把上下压扁，凑成软囊的比例。',
              ],
            },
          ],
        },
        L3: {
          name: '标本 03 · 收缩肌束',
          intro: '标本总是蜷着……里面好像有两根肌腱在收紧。',
          targets: [
            {
              name: '摊平的肌片',
              hint: '两根肌腱在把两端往一起拽。把两端钉远一点，肌片就绷平了。',
              moreHints: [
                '双击钉住左端（拉开些），再钉住右端，标本就绷直了。',
                '还差一点？用第三个控制点把鼓起的区域往下抹平。千万别切肌腱——后面有用。',
              ],
            },
            {
              name: '对折的肌瓣',
              hint: '顺着肌腱的拉力把标本对折，捏拢两端，再用缝合固定。要是肌腱断了……只能重开。',
              moreHints: [
                '解开所有图钉，让肌腱把标本拽弯，再抓两端往一起凑。',
                '两端凑近后：换缝合工具（按 3），按住一端的边缘，拖到另一端的边缘松开。',
              ],
            },
          ],
        },
        L4: {
          name: '标本 04 · 脉管三岔',
          intro: '三根脉管，三种质地。下刀之前，先想想顺序。',
          targets: [
            {
              name: '充血鼓包',
              hint: '先别切！腔内血压撑着它，捏圆就好。小心：有根血管已经钙化，一拉就断。',
              moreHints: [
                '把五个角轻轻往里揉圆。动作轻点——猛拉会把钙化血管拉断。',
              ],
            },
            {
              name: '箭形组织',
              hint: '放掉右下角血窦里的血，但留着那根骨条，顶住箭形的左角。',
              moreHints: [
                '从右下角外面斜着切一小刀，只切断那个小血窦。',
                '左边那根横着的骨条别动——它是撑住箭形左角的支架。',
              ],
            },
            {
              name: '松弛囊体',
              hint: '现在，把最后那根骨条也剪断，让标本彻底松弛。',
              moreHints: [
                '从左边外面横着切进去，切断那根骨条，然后揉圆。',
              ],
            },
          ],
        },
        L5: {
          name: '标本 05 · 复合脏器',
          intro: '这是结业摘检：每根脉管的质地都不一样。',
          targets: [
            {
              name: '球状体',
              hint: '先把标本揉圆。顺便试探一下每根脉管的性子。',
              moreHints: [
                '顶上那根肌腱把顶部拽平了——揉圆时重点补顶部和底部。',
              ],
            },
            {
              name: '扁平叶',
              hint: '左下角埋着一个血窦。给它放血，但别切到别的脉管。',
              moreHints: [
                '从左下角外面斜着切一小刀，刚好够到那个小血窦就停。',
                '放血后钉住左右两端，把标本压成扁平叶。',
              ],
            },
            {
              name: '双叶',
              hint: '手起刀落，一分为二，再把两叶分开摆好。',
              moreHints: [
                '从正上方外面往下垂直一刀切到底，把标本劈成两半。',
                '抓住其中一叶拖远一点，摆成左右两团。',
              ],
            },
            {
              name: '叠层块',
              hint: '把两叶摞起来，用缝合固定接缝，堆成一座叠层块。',
              moreHints: [
                '把一叶拖到另一叶的正上方，让它们贴在一起。',
                '换缝合工具：按住上叶的下边缘，拖到下叶的上边缘松开，缝两针更牢。',
              ],
            },
          ],
        },
        L6: {
          name: '标本 06 · 立方胚块',
          intro: '拖动顶点感受它的弹性；拖住空白处可以转动视角。读数先别急。',
          targets: [
            {
              name: '压扁的胚层',
              hint: '开局读数只有十几分是正常的——软骨支柱没剪断，「脉管结构不符」会把读数压到四分之一。按 2 换手术刀，对准软骨支柱点一下。',
              moreHints: [
                '换手术刀（按 2），对准那根软骨支柱点一下。',
                '剪断后：钉住底面，抓顶面往下压扁，跟着虚线框走。',
              ],
            },
            {
              name: '伸长的胚柱',
              hint: '钉住底面一角，抓住顶面往上拔。慢慢来。',
              moreHints: [
                '双击钉住底面两个角，抓顶面中心往上拔高。',
                '拖空白处转个视角，检查四面是否都收窄了。',
              ],
            },
          ],
        },
      },
    },
    toasts: {
      rejected: '只能从标本外部下刀',
      deflate: '噗——放血了，它瘪下去了',
      snap: '啪！一根钙化血管绷断了',
      weld: '缝合完成',
      weldCut: '缝线被切开了',
      pipeCut: '切断了一根血管',
      crumb: '掉了一小块组织',
      bannerPass: '摘检完成',
      topoWarn: '⚠ 脉管结构不符 · 读数被压至 25%',
      topoFixed: '脉管结构对上了——照着虚线框继续塑形，读数会跟着爬升',
      topoDeadlock: '脉管拓扑已不可恢复，本目标无法达成——按 R 重开标本',
      away: '标本正在归位——稍候，或按 R 立即复位',
      cutTip2d: '从标本外面按住，划一条线切进去',
      cutTip3d: '对准脉管点一下即可剪断',
      glue3d: '3D 关卡暂不支持缝合',
      loseTail: '摸清每根脉管的性子再来！',
    },
    // 会话层 emit('hint') 的原文 -> bio 平行文案（按原文精确匹配，缺省原样）。
    strings: {
      '先点住软体的边缘': '先点住组织的边缘',
      '要贴到另一段边缘上': '要缝到另一段边缘上',
      '离得太近，粘不出名堂': '离得太近，缝不出名堂',
      '不能自己粘自己': '不能自己缝自己',
      '粘合失败': '缝合失败',
      '对准管道点一下，就能剪断它': '对准脉管点一下，就能剪断它',
    },
    fx: {
      pulse: true,
      deflateStyle: 'fluid',
      debrisStyle: 'calcified',
      sfx: 'organic',
      rejectLabel: '只能从标本外部下刀',
      // 生物材质档案（单一数据源）：会话层读取并注入引擎的可选物理特性。
      // lab 无 physics 键 => 引擎一切新特性关闭，与既有行为逐位一致。
      physics: {
        // 亚临界阻尼：软组织高耗散，松手缓慢定形而非果冻回振。
        // （Planner 原型 0.88；0.92 振铃指标同样达标——止息 0.62s、过零 0，
        //   且 L2 目标二在 bio 物理下的作者解可过 cutoff，0.88 过不了。）
        solver: { damping: 0.92, viscoelastic: true },
        body: {
          // SLS 蠕变：持续拉扯让膜的静息长度向当前长度迁移（组织"流动"），
          // 松手后向出厂 rest0 回复；±2% 应变死区内只回复不蠕变。
          membraneCreep: { creepK: 0.5, recoverK: 0.3, creepOnset: 0.02, restLo: 0.7, restHi: 1.5 },
          // J 形应力-应变：超过 15% 应变后胶原募集，柔度按 (1+4·excess²) 收紧。
          membraneHarden: { hardenK: 4, hardenOnset: 0.15 },
        },
        // 按管型覆盖 PIPE_STYLES（本轮暂无覆盖；肌肉动态留后轮）。
        pipeStyles: {},
        // 搏动性失血：切断承压环后，失压目标随心搏分 4 跳阶梯下调。
        bleed: { pulses: 4 },
      },
    },
  },
};

let current = null;

function storedThemeId() {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'lab';
  } catch {
    return 'lab'; // 无 localStorage（Node 测试 / 隐私模式）：兜底 lab
  }
}

/** 当前主题；无 localStorage 环境下安全返回 lab。 */
export function currentTheme() {
  if (!current) current = THEMES[storedThemeId()] ?? THEMES.lab;
  return current;
}

/** 切换主题并持久化（localStorage 'polyform.theme'）。 */
export function setTheme(id) {
  current = THEMES[id] ?? THEMES.lab;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, current.meta.id);
  } catch { /* 隐私模式：仅本次会话生效 */ }
  return current;
}

// ---- 兜底取值 helpers（lab 主题全部返回 null / 原文） ------------------------

/** 关卡级主题文案 { name, intro, targets } | null。 */
export function themeLevel(levelId) {
  return currentTheme().text?.levels?.[levelId] ?? null;
}

/** 目标级主题文案 { name, hint, moreHints } | null。 */
export function themeTarget(levelId, targetIdx) {
  return themeLevel(levelId)?.targets?.[targetIdx] ?? null;
}

/** 事件 toast / 固定短语覆盖；无覆盖返回 null。 */
export function themeToast(key) {
  return currentTheme().toasts?.[key] ?? null;
}

/** 会话层 hint 原文 -> 主题平行文案；无映射原样返回。 */
export function themeString(text) {
  return currentTheme().strings?.[text] ?? text;
}

/** 表现层 fx 参数（脉搏 / 粒子风格 / 音色组）。 */
export function themeFx() {
  return currentTheme().fx;
}
