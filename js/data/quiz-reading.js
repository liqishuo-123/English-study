/* =========================================================
   data/quiz-reading.js — 仔细阅读（原创仿真题）
   说明：以下文章与题目均为本项目原创撰写，不是官方真题原文。
        想练真题请用「真题训练 → 录入真题」把自行购买的真题导入系统。
   ========================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  App.QUIZ_BUILTIN = App.QUIZ_BUILTIN || [];

  App.QUIZ_BUILTIN.push(
    {
      id: 'rd_1',
      type: 'reading',
      source: 'builtin',
      year: '',
      paper: '原创仿真 · 第 1 套',
      title: 'Why We Forget What We Just Learned',
      passage: 'Most students have had this experience: you read a chapter carefully, feel confident that you understand it, and then a week later you can barely recall a single key point. This is not a sign of a poor memory. It is simply how human memory works.\n\nIn the nineteenth century, the German psychologist Hermann Ebbinghaus tested his own memory by learning lists of nonsense syllables. He found that forgetting is not gradual in the way people expect. Instead, it is extremely steep at the beginning and then flattens out. Within one hour of learning something new, a large share of it has already slipped away.\n\nThis discovery has an important practical implication. The timing of review matters as much as the amount of study. Reviewing material shortly after the first exposure dramatically slows the rate of forgetting. Each successful review then pushes the next review further into the future. This is the principle behind spaced repetition, a technique now built into many learning applications.\n\nHowever, spacing alone is not enough. Research consistently shows that retrieval practice — actively pulling information out of your memory rather than rereading it — produces far stronger retention. Students who close the book and test themselves remember significantly more than students who spend the same time reviewing their notes. The effort of recalling feels harder, and that difficulty is precisely what strengthens the memory.\n\nThe lesson for anyone preparing for an exam is straightforward. Read less, recall more, and space your practice out over days and weeks instead of cramming the night before.',
      subQuestions: [
        {
          stem: 'What is the main idea of the passage?',
          options: [
            'A. Human memory is far weaker than most people believe.',
            'B. Forgetting follows a predictable pattern that can be countered with better study methods.',
            'C. Hermann Ebbinghaus was the first scientist to study human memory.',
            'D. Cramming is the most efficient way to prepare for an examination.'
          ],
          answer: 'B',
          explanation: '全文先讲遗忘的规律（艾宾浩斯曲线），再据此给出 spaced repetition 与 retrieval practice 两种对策，最后给出备考建议。B 项概括最完整。A 只涉及现象，C 是细节，D 与文意相反。'
        },
        {
          stem: 'According to Ebbinghaus\'s findings, forgetting is ______.',
          options: [
            'A. steady and predictable over time',
            'B. very rapid at first and then much slower',
            'C. almost nonexistent in the first hour',
            'D. unaffected by how often material is reviewed'
          ],
          answer: 'B',
          explanation: '第二段明确说 forgetting 是 "extremely steep at the beginning and then flattens out"，且一小时内已遗忘大半，故选 B。'
        },
        {
          stem: 'The word "steep" in Paragraph 2 is closest in meaning to ______.',
          options: ['A. narrow', 'B. flat', 'C. sharp', 'D. smooth'],
          answer: 'C',
          explanation: 'steep 原指「陡峭的」，此处形容遗忘曲线下降很快，与 sharp（急剧的）意思最接近。'
        },
        {
          stem: 'What does the author say about retrieval practice?',
          options: [
            'A. It is less effective than rereading notes.',
            'B. It feels easier but produces weaker retention.',
            'C. It is harder than rereading but strengthens memory.',
            'D. It only works when combined with long study sessions.'
          ],
          answer: 'C',
          explanation: '第四段指出主动回忆 "feels harder, and that difficulty is precisely what strengthens the memory"，对应 C。'
        },
        {
          stem: 'What advice does the author give to exam candidates?',
          options: [
            'A. Read as much material as possible before the exam.',
            'B. Test yourself often and spread study over time.',
            'C. Focus on memorising facts the night before.',
            'D. Avoid reviewing material more than once.'
          ],
          answer: 'B',
          explanation: '末段 "Read less, recall more, and space your practice out over days and weeks" 对应 B 的 test yourself often 与 spread study over time。'
        }
      ]
    },

    {
      id: 'rd_2',
      type: 'reading',
      source: 'builtin',
      year: '',
      paper: '原创仿真 · 第 2 套',
      title: 'The Hidden Cost of Constant Connection',
      passage: 'Smartphones were sold to us as tools of liberation. They would let us work from anywhere, keep in touch with everyone, and never waste a spare minute. A growing body of research suggests the reality is more complicated.\n\nThe problem is not the device itself but the interruptions it produces. Studies of office workers indicate that after an interruption, it takes an average of more than twenty minutes to return to the original task at a genuinely deep level. Most people, however, switch back within seconds and simply work at a shallower level for the rest of the session. The result is a working day that feels busy but produces little.\n\nThis matters more for some kinds of work than others. Tasks that require holding several ideas in mind at once — writing, programming, solving complex problems — suffer most. Shallow tasks such as answering routine messages are barely affected. This explains why two people can use the same phone in the same way and experience very different outcomes.\n\nInterestingly, the people who suffer most are often the ones most convinced they are good at multitasking. When researchers compare actual performance with self-assessment, heavy multitaskers consistently rate themselves highly while performing poorly on measures of attention and task switching. Confidence and competence, in this domain, are inversely related.\n\nNone of this means we should abandon our devices. It means the default settings are working against us. Turning off non-essential notifications, grouping message checks into fixed times, and keeping the phone out of sight during deep work are cheap changes with measurable benefits.',
      subQuestions: [
        {
          stem: 'What is the passage mainly about?',
          options: [
            'A. The history of smartphone development.',
            'B. How constant interruptions damage deep work, and what can be done.',
            'C. Why office workers should give up their phones entirely.',
            'D. The advantages of working from anywhere.'
          ],
          answer: 'B',
          explanation: '文章先提出手机带来的持续打断问题，再说明其对深度工作的损害，最后给出可行的改进办法。B 最全面。C 过度推断，文章末段明确说不必放弃设备。'
        },
        {
          stem: 'According to the passage, after being interrupted most people ______.',
          options: [
            'A. take over twenty minutes to resume their task',
            'B. return immediately but work less deeply',
            'C. abandon the original task altogether',
            'D. become more productive than before'
          ],
          answer: 'B',
          explanation: '第二段说真正恢复深度状态需要二十多分钟，但 "Most people... switch back within seconds and simply work at a shallower level"，故选 B。'
        },
        {
          stem: 'Which type of work is least affected by interruptions?',
          options: [
            'A. Writing an essay',
            'B. Solving a complex problem',
            'C. Answering routine messages',
            'D. Computer programming'
          ],
          answer: 'C',
          explanation: '第三段说 "Shallow tasks such as answering routine messages are barely affected"，其余三项都被列为受影响最大的工作。'
        },
        {
          stem: 'What does the research say about heavy multitaskers?',
          options: [
            'A. They perform better than they think they do.',
            'B. They rate themselves highly but perform poorly.',
            'C. They are usually aware of their weaknesses.',
            'D. They avoid shallow tasks entirely.'
          ],
          answer: 'B',
          explanation: '第四段指出重度多任务者 "rate themselves highly while performing poorly"，即自信与能力成反比，选 B。'
        },
        {
          stem: 'Which measure does the author NOT recommend?',
          options: [
            'A. Disabling unnecessary notifications.',
            'B. Checking messages at set times.',
            'C. Keeping the phone out of sight while concentrating.',
            'D. Buying a new phone with better performance.'
          ],
          answer: 'D',
          explanation: '末段提到的建议是关闭非必要通知、固定时段查看消息、深度工作时把手机移出视线，未提及换新设备，故选 D。'
        }
      ]
    },

    {
      id: 'rd_3',
      type: 'reading',
      source: 'builtin',
      year: '',
      paper: '原创仿真 · 第 3 套',
      title: 'Can a City Be Designed for Walking?',
      passage: 'For most of the twentieth century, city planners designed streets around cars. The measure of a good road was how many vehicles it could move per hour, and the pedestrian was an afterthought. In recent decades, a growing number of cities have begun to reverse that logic.\n\nThe change is driven by evidence rather than fashion. Neighbourhoods built at a fine grain — short blocks, many intersections, shops mixed among homes — consistently show higher levels of walking, lower rates of obesity, and stronger local economies. Residents of such areas make a larger share of their trips on foot or by bicycle, not because they are unusually disciplined, but because the destinations they need are close enough to reach.\n\nDensity alone, however, is not a solution. What matters is what planners call the "five-minute walk": the distance a person can comfortably cover in five minutes, roughly four hundred metres. When daily needs such as groceries, schools and clinics fall inside that radius, car ownership drops sharply. When they fall outside it, even well-designed pavements go unused.\n\nCritics warn that walkable neighbourhoods are expensive, and in the short term they are right. Retrofitting a car-oriented suburb requires new pavements, new crossings, and often new zoning rules. Supporters reply that the comparison is misleading. Car-oriented development carries its own heavy costs — roads, parking, pollution, and the public health burden of inactivity — but these costs are spread across the whole population and paid for over decades, which makes them easy to overlook.',
      subQuestions: [
        {
          stem: 'What is the passage primarily concerned with?',
          options: [
            'A. The history of car manufacturing in the twentieth century.',
            'B. The benefits and costs of designing cities for walking.',
            'C. How to build cheaper housing in modern cities.',
            'D. Why bicycles are better than cars.'
          ],
          answer: 'B',
          explanation: '文章围绕「步行友好型城市」展开，先讲转变背景，再讲收益与「五分钟步行圈」，最后讨论批评者的成本质疑及反驳。B 最准确。'
        },
        {
          stem: 'The phrase "an afterthought" in Paragraph 1 most probably means ______.',
          options: [
            'A. the most important consideration',
            'B. something considered only later and treated as unimportant',
            'C. a carefully planned feature',
            'D. a source of constant debate'
          ],
          answer: 'B',
          explanation: '首段说规划者以汽车为中心，行人只是 an afterthought，即「事后才想到、不被重视的东西」，选 B。'
        },
        {
          stem: 'Why do residents of fine-grained neighbourhoods walk more?',
          options: [
            'A. They have stronger self-discipline than others.',
            'B. Public transport is unavailable there.',
            'C. The places they need are within easy walking distance.',
            'D. Cars are forbidden in those areas.'
          ],
          answer: 'C',
          explanation: '第二段末尾 "not because they are unusually disciplined, but because the destinations they need are close enough to reach"，直接对应 C。'
        },
        {
          stem: 'What is the "five-minute walk" mentioned in Paragraph 3?',
          options: [
            'A. A daily exercise recommendation for residents.',
            'B. The distance of roughly four hundred metres that people will comfortably walk.',
            'C. The maximum length of a city block.',
            'D. The time needed to drive to the nearest shop.'
          ],
          answer: 'B',
          explanation: '第三段给出定义：五分钟可舒适走完的距离，约四百米，选 B。'
        },
        {
          stem: 'How do supporters respond to the criticism about cost?',
          options: [
            'A. They agree that walkable cities are too expensive.',
            'B. They argue that car-oriented development also has large hidden costs.',
            'C. They suggest raising taxes to pay for the changes.',
            'D. They claim the cost will disappear within a year.'
          ],
          answer: 'B',
          explanation: '末段支持者认为这种比较有误导性，因为以汽车为导向的开发同样有道路、停车、污染和公共健康等高额成本，只是被分摊和延后而容易被忽视，选 B。'
        }
      ]
    },

    {
      id: 'rd_4',
      type: 'reading',
      source: 'builtin',
      year: '',
      paper: '原创仿真 · 第 4 套',
      title: 'The Myth of the Natural Talent',
      passage: 'When a young musician performs brilliantly, the audience usually reaches for the same explanation: talent. The word is comforting because it suggests that ability is something you are born with, and that the rest of us were simply not chosen. Decades of research into expertise tell a different story.\n\nIn study after study, the strongest predictor of achievement is not any measurable innate capacity but the sheer amount of deliberate practice accumulated. Deliberate practice is not simply repeating what you already do well. It means working at the edge of your current ability, receiving immediate feedback, and correcting specific weaknesses. It is uncomfortable by design, which is exactly why so few people sustain it.\n\nThis has consequences for how we teach. If ability were fixed, the sensible strategy would be to identify the gifted early and invest resources in them. But if ability is largely built, then early selection is not only unfair but inaccurate — it mistakes current level for future potential, and it discourages late developers who might otherwise excel.\n\nThere is a more subtle implication. Because deliberate practice depends on feedback, the quality of the teacher matters enormously. A student who practises alone for ten years may simply have rehearsed the same errors ten thousand times. What separates rapid improvers from the rest is rarely more hours; it is better information about what to fix next.\n\nNone of this denies that people differ. Starting points are not identical, and interests vary. But the differences that appear at the beginning of a journey explain surprisingly little about where people end up.',
      subQuestions: [
        {
          stem: 'What is the main point of the passage?',
          options: [
            'A. Natural talent is the best predictor of musical success.',
            'B. Achievement comes mainly from sustained, feedback-driven practice rather than inborn talent.',
            'C. Teachers are less important than students believe.',
            'D. Early selection of gifted children should be expanded.'
          ],
          answer: 'B',
          explanation: '全文核心是质疑天赋决定论，强调刻意练习与反馈的作用。A、D 与文意相反；C 与第四段「教师质量极其重要」相悖。'
        },
        {
          stem: 'The word "innate" in Paragraph 2 is closest in meaning to ______.',
          options: ['A. learned', 'B. inborn', 'C. trained', 'D. measured'],
          answer: 'B',
          explanation: 'innate 意为「先天的、与生俱来的」，与 inborn 同义。'
        },
        {
          stem: 'According to the passage, deliberate practice involves all of the following EXCEPT ______.',
          options: [
            'A. working at the limit of one\'s current ability',
            'B. getting immediate feedback',
            'C. correcting particular weaknesses',
            'D. repeating tasks one has already mastered'
          ],
          answer: 'D',
          explanation: '第二段明确说 "Deliberate practice is not simply repeating what you already do well"，故 D 不属于刻意练习。'
        },
        {
          stem: 'Why does the author mention a student practising alone for ten years?',
          options: [
            'A. To show that long practice guarantees success.',
            'B. To illustrate that practice without feedback may simply repeat mistakes.',
            'C. To argue that private practice should be banned.',
            'D. To compare music with other subjects.'
          ],
          answer: 'B',
          explanation: '第四段以独自练习十年为例，说明缺乏反馈可能只是把同样的错误重复一万次，对应 B。'
        },
        {
          stem: 'What is the author\'s attitude towards differences in starting points?',
          options: [
            'A. They are the decisive factor in long-term success.',
            'B. They do not exist at all.',
            'C. They exist but explain little about final achievement.',
            'D. They should determine who receives training.'
          ],
          answer: 'C',
          explanation: '末段承认起点不同、兴趣各异，但 "explain surprisingly little about where people end up"，对应 C。'
        }
      ]
    }
  );
})(window);
