/* =========================================================
   data/writing.js — 写作与翻译素材库
   分类：template 作文模板 / pattern 万能句型 / synonym 高级替换词 / translation 翻译句式
   字段：id, cat, title, content, tags
   ========================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  App.WRITING_BUILTIN = App.WRITING_BUILTIN || [];

  App.WRITING_BUILTIN.push(
    /* ---------------- 作文模板 ---------------- */
    {
      id: 'wt_t1', cat: 'template', title: '现象说明型（首段）',
      tags: ['开头', '图表', '现象'],
      content: 'Nowadays, with the rapid development of ______, an increasing number of people have begun to ______. According to a recent survey, nearly ______ percent of ______. This phenomenon has aroused widespread concern in society.'
    },
    {
      id: 'wt_t2', cat: 'template', title: '观点对比型（正文段）',
      tags: ['正文', '对比', '论证'],
      content: 'Opinions on this issue vary from person to person. Some people hold the view that ______, because ______. Others, however, argue that ______. From my perspective, the latter view carries more weight, for the simple reason that ______.'
    },
    {
      id: 'wt_t3', cat: 'template', title: '原因分析型（正文段）',
      tags: ['正文', '原因', '论证'],
      content: 'There are several factors contributing to this phenomenon. To begin with, ______. What is more, ______. Last but not least, ______. Were there no ______, the situation would be quite different.'
    },
    {
      id: 'wt_t4', cat: 'template', title: '措施建议型（正文段）',
      tags: ['正文', '建议', '措施'],
      content: 'In view of the seriousness of the problem, effective measures must be taken before things get worse. First and foremost, the authorities should ______. In addition, it is high time that we ______. Only through these joint efforts can we ______.'
    },
    {
      id: 'wt_t5', cat: 'template', title: '结尾总结型（末段）',
      tags: ['结尾', '总结', '升华'],
      content: 'To sum up, although ______ may bring some convenience, we should not turn a blind eye to its drawbacks. Only by ______ can we ______. I am firmly convinced that a brighter future is awaiting us if we ______.'
    },
    {
      id: 'wt_t6', cat: 'template', title: '图表描述型（首段）',
      tags: ['开头', '图表', '数据'],
      content: 'As is vividly shown in the chart, the number of ______ has increased / decreased sharply from ______ in ______ to ______ in ______. Meanwhile, the figure for ______ remained relatively stable. What accounts for this remarkable change?'
    },
    {
      id: 'wt_t7', cat: 'template', title: '名言引用型（开头）',
      tags: ['开头', '引用', '加分'],
      content: 'Just as the saying goes, "______." This remark is particularly true when it comes to ______. It reminds us that ______, a lesson that is as relevant today as it was centuries ago.'
    },

    /* ---------------- 万能句型 ---------------- */
    {
      id: 'wt_p1', cat: 'pattern', title: '强调句',
      tags: ['强调', '加分'],
      content: 'It is / was + 被强调部分 + that / who + 其余部分\n\n例：It is through constant practice that we eventually master a foreign language.\n（正是通过持续的练习，我们最终掌握了一门外语。）'
    },
    {
      id: 'wt_p2', cat: 'pattern', title: '倒装句（Only / Not only）',
      tags: ['倒装', '加分'],
      content: 'Only + 状语 + 助动词 + 主语 + 谓语\nNot only + 助动词 + 主语 + 谓语, but also ...\n\n例 1：Only by working together can we solve this problem.\n例 2：Not only does reading broaden our horizons, but it also enriches our inner world.'
    },
    {
      id: 'wt_p3', cat: 'pattern', title: '虚拟语气',
      tags: ['虚拟', '加分'],
      content: 'It is high time that + 主语 + 过去式\nIf I were ..., I would ...\n\n例 1：It is high time that we took effective measures to protect the environment.\n例 2：Were I given another chance, I would make a different choice.'
    },
    {
      id: 'wt_p4', cat: 'pattern', title: '定语从句（非限定性）',
      tags: ['从句', '加分'],
      content: '..., which + 谓语 ...\n\n例：He devoted all his spare time to reading, which laid a solid foundation for his later success.\n（他把全部业余时间用于阅读，这为他日后的成功打下了坚实基础。）'
    },
    {
      id: 'wt_p5', cat: 'pattern', title: 'with 复合结构',
      tags: ['结构', '加分'],
      content: 'with + 宾语 + 宾语补足语（形容词 / 介词短语 / 分词）\n\n例：With the final examination approaching, all the students are busy preparing for it.\n（随着期末考试临近，所有学生都在忙着备考。）'
    },
    {
      id: 'wt_p6', cat: 'pattern', title: '双重否定表强调',
      tags: ['强调', '加分'],
      content: 'It is not uncommon that ... / We can never fail to ...\n\n例 1：It is not uncommon that students feel anxious before an important exam.\n例 2：We can never fail to notice the great changes that have taken place in our city.'
    },
    {
      id: 'wt_p7', cat: 'pattern', title: '过渡衔接句式',
      tags: ['衔接', '逻辑'],
      content: '引出观点：When it comes to ..., opinions vary from person to person.\n补充：What is more / Moreover / In addition\n转折：Nevertheless / On the contrary / However\n因果：As a result / Consequently / Thanks to\n总结：To sum up / In conclusion / All in all'
    },
    {
      id: 'wt_p8', cat: 'pattern', title: 'it 作形式主语',
      tags: ['结构', '常用'],
      content: 'It is + adj. + (for / of sb.) + to do sth.\nIt is said / reported / believed that ...\n\n例 1：It is of great importance for college students to develop good study habits.\n例 2：It is universally acknowledged that education plays a vital role in personal growth.'
    },
    {
      id: 'wt_p9', cat: 'pattern', title: '分词作状语',
      tags: ['结构', '加分'],
      content: 'Doing ..., 主语 + 谓语 / Done ..., 主语 + 谓语\n\n例 1：Realizing the importance of English, he decided to practise every day.\n例 2：Faced with such a difficult situation, she chose to stay calm.'
    },

    /* ---------------- 高级替换词 ---------------- */
    {
      id: 'wt_s1', cat: 'synonym', title: '「重要的」的 8 种升级写法',
      tags: ['形容词', '替换'],
      content: 'important → crucial / vital / significant / essential / indispensable / of great importance\n\n例：Sleep is vital to memory consolidation.\n（睡眠对记忆巩固至关重要。）'
    },
    {
      id: 'wt_s2', cat: 'synonym', title: '「很多」的升级写法',
      tags: ['数量', '替换'],
      content: 'many / a lot of → a host of / a great many / a considerable number of / a large proportion of / numerous / a variety of\n\n例：A considerable number of students have benefited from the program.'
    },
    {
      id: 'wt_s3', cat: 'synonym', title: '「我认为」的 6 种升级写法',
      tags: ['观点', '替换'],
      content: 'I think → I am firmly convinced that / From my perspective / As far as I am concerned / I am inclined to believe that / It seems to me that / I hold the view that\n\n例：As far as I am concerned, the advantages outweigh the disadvantages.'
    },
    {
      id: 'wt_s4', cat: 'synonym', title: '「越来越…」的写法',
      tags: ['趋势', '替换'],
      content: 'more and more + adj. → increasingly + adj.\nmore and more + n. → a growing / rising number of + n.\n\n例 1：The problem is becoming increasingly serious.\n例 2：A growing number of people choose to work from home.'
    },
    {
      id: 'wt_s5', cat: 'synonym', title: '「引起 / 导致」的升级写法',
      tags: ['动词', '替换'],
      content: 'cause → lead to / result in / give rise to / contribute to / bring about / trigger\n\n例：Poor sleep can give rise to a decline in concentration.\n（睡眠不足会导致注意力下降。）'
    },
    {
      id: 'wt_s6', cat: 'synonym', title: '「努力 / 尝试」的升级写法',
      tags: ['动词', '替换'],
      content: 'try to do → make every effort to / spare no effort to / strive to / endeavour to / make an attempt to\n\n例：We should spare no effort to protect endangered species.'
    },
    {
      id: 'wt_s7', cat: 'synonym', title: '「优点 / 缺点」的升级写法',
      tags: ['名词', '替换'],
      content: 'advantages and disadvantages → merits and demerits / strengths and weaknesses / pros and cons / the bright and dark sides\n\n例：Every coin has two sides; we must weigh the pros and cons before deciding.'
    },
    {
      id: 'wt_s8', cat: 'synonym', title: '「非常」的升级写法',
      tags: ['程度', '替换'],
      content: 'very → extremely / exceedingly /remarkably / considerably / tremendously / to a large extent\n\n例：The situation has improved considerably over the past decade.'
    },

    /* ---------------- 翻译句式 ---------------- */
    {
      id: 'wt_x1', cat: 'translation', title: '「随着…的发展」',
      tags: ['开头', '高频'],
      content: 'With the development / rapid growth of ..., ...\n\n例：随着经济的发展，人们的生活水平显著提高。\nWith the development of the economy, people\'s living standards have improved significantly.'
    },
    {
      id: 'wt_x2', cat: 'translation', title: '「据报道 / 据说」',
      tags: ['被动', '高频'],
      content: 'It is reported / said / estimated that ...\n... be said / reported to do ...\n\n例：据报道，这座城市明年将建成三条地铁线路。\nIt is reported that three new subway lines will be completed in this city next year.'
    },
    {
      id: 'wt_x3', cat: 'translation', title: '「不仅…而且…」',
      tags: ['并列', '高频'],
      content: 'not only ... but also ... / Not only + 倒装\n\n例：这个活动不仅丰富了课余生活，还提高了我们的实践能力。\nThe activity not only enriched our after-class life, but also improved our practical ability.'
    },
    {
      id: 'wt_x4', cat: 'translation', title: '「只有…才…」',
      tags: ['倒装', '高频'],
      content: 'Only by / through / when ... can we ...（句首倒装）\n\n例：只有通过不断练习，我们才能掌握这门技能。\nOnly through constant practice can we master this skill.'
    },
    {
      id: 'wt_x5', cat: 'translation', title: '「尽管 / 虽然」',
      tags: ['让步', '高频'],
      content: 'Although / Though ... / Despite / In spite of + 名词\n\n例：尽管遇到了许多困难，他从未放弃。\nIn spite of many difficulties, he never gave up.'
    },
    {
      id: 'wt_x6', cat: 'translation', title: '「一方面…另一方面…」',
      tags: ['并列', '高频'],
      content: 'On the one hand, ... On the other hand, ...\nFor one thing, ... For another, ...\n\n例：一方面网络提供了便利；另一方面它也带来了新的问题。\nOn the one hand, the internet provides great convenience; on the other hand, it has brought about new problems.'
    },
    {
      id: 'wt_x7', cat: 'translation', title: '「把…视为…」',
      tags: ['动词', '高频'],
      content: 'regard / consider / view / treat ... as ...\n... be regarded / considered as ...\n\n例：茶在中国被视为传统文化的重要组成部分。\nTea is regarded as an important part of traditional Chinese culture.'
    },
    {
      id: 'wt_x8', cat: 'translation', title: '「越来越受到重视」',
      tags: ['被动', '高频'],
      content: '... has received increasing attention / ... be attached great importance to\n\n例：近年来，环境保护越来越受到重视。\nIn recent years, environmental protection has received increasing attention.'
    },
    {
      id: 'wt_x9', cat: 'translation', title: '「对…有重要影响」',
      tags: ['影响', '高频'],
      content: 'have a great / profound / far-reaching influence / impact on ...\nplay an important / vital role in ...\n\n例：家庭教育对孩子的成长有着深远的影响。\nFamily education has a far-reaching influence on children\'s growth.'
    },
    {
      id: 'wt_x10', cat: 'translation', title: '「采取措施 / 采取行动」',
      tags: ['措施', '高频'],
      content: 'take measures / steps / action to do sth.\neffective measures be taken to do sth.\n\n例：政府已经采取了一系列措施来控制房价。\nThe government has taken a series of measures to control housing prices.'
    }
  );
})(window);
