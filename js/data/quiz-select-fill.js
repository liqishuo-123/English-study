/* =========================================================
   data/quiz-select-fill.js — 选词填空（原创仿真题）
   结构：options 为 15 个候选词，passage 中 [[1]] ~ [[10]] 为挖空位置，
        subQuestions 每个空一条，answer 填候选词原形。
   ========================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  App.QUIZ_BUILTIN = App.QUIZ_BUILTIN || [];

  App.QUIZ_BUILTIN.push(
    {
      id: 'sf_1',
      type: 'select-fill',
      source: 'builtin',
      year: '',
      paper: '原创仿真 · 第 1 套',
      title: 'Learning a Language as an Adult',
      options: [
        'acquire', 'advantage', 'constant', 'decline', 'efficient',
        'expose', 'gradual', 'motivate', 'obstacle', 'recognise',
        'reinforce', 'retain', 'strategy', 'sufficient', 'variety'
      ],
      passage: 'Many adults believe that language learning is a talent reserved for the young. Research, however, suggests a more encouraging picture. While children do have a clear [[1]] in pronunciation, older learners often [[2]] new vocabulary faster because they can link it to knowledge they already possess.\n\nThe real [[3]] for adults is rarely age itself. It is time. Learning a language requires [[4]] exposure, and adults usually have less of it. A learner who studies two hours a week for a year will progress far more slowly than one who [[5]] herself to the language for thirty minutes every day.\n\nA second difficulty is that adults rarely [[6]] how slow real progress is. They look for the most [[7]] method and become discouraged when improvement proves [[8]] rather than dramatic. In reality, vocabulary is [[9]] through repeated encounters in different contexts, not through a single memorisation session. The most useful way to [[10]] yourself is therefore simple: read and listen to a wide variety of material every day, and review what you meet.',
      subQuestions: [
        { stem: '第 1 空', answer: 'advantage', explanation: 'have an advantage in... 表示「在…方面有优势」，与后半句 older learners 更快形成对比。' },
        { stem: '第 2 空', answer: 'acquire', explanation: 'acquire vocabulary 为固定搭配，表示「习得词汇」。' },
        { stem: '第 3 空', answer: 'obstacle', explanation: 'the real obstacle 表示「真正的障碍」，承接上文「问题不在于年龄本身」。' },
        { stem: '第 4 空', answer: 'constant', explanation: 'constant exposure 表示「持续的接触」，与下文 every day 呼应。' },
        { stem: '第 5 空', answer: 'expose', explanation: 'expose oneself to... 表示「使自己接触到…」，主语 one 为第三人称单数，故加 -s。' },
        { stem: '第 6 空', answer: 'recognise', explanation: 'recognise 表示「认识到」，句意为「成年人很少意识到真正的进步有多慢」。' },
        { stem: '第 7 空', answer: 'efficient', explanation: 'the most efficient method 表示「最高效的方法」。' },
        { stem: '第 8 空', answer: 'gradual', explanation: 'gradual rather than dramatic 表示「渐进的而非戏剧性的」，构成对比；此处 improvement 与 progress 同义复现。' },
        { stem: '第 9 空', answer: 'retain', explanation: '被动语态，需填 retain 的过去分词 retained，句意为「词汇是通过反复接触而被记住的」。' },
        { stem: '第 10 空', answer: 'motivate', explanation: 'motivate yourself 表示「激励自己」，动词不定式后接原形。' }
      ]
    },

    {
      id: 'sf_2',
      type: 'select-fill',
      source: 'builtin',
      year: '',
      paper: '原创仿真 · 第 2 套',
      title: 'The Sharing Economy',
      options: [
        'access', 'benefit', 'commercial', 'competition', 'consume',
        'emerge', 'flexible', 'income', 'regulate', 'reliable',
        'resource', 'rural', 'significant', 'traditional', 'urban'
      ],
      passage: 'Over the past fifteen years, a new kind of [[1]] activity has [[2]] in cities around the world. Instead of owning goods, people pay for temporary [[3]] to them: a car for an hour, a room for a night, a tool for an afternoon.\n\nSupporters point to one clear [[4]]: idle [[5]] such as spare rooms and parked cars are used more productively. They also note that the model offers [[6]] work to people who cannot take a [[7]] nine-to-five job.\n\nCritics, however, argue that the sector has grown faster than the rules that [[8]] it. Questions about safety, insurance and tax remain unresolved in many places. There is also a [[9]] concern that the platforms may drive local shops out of business through unfair [[10]].',
      subQuestions: [
        { stem: '第 1 空', answer: 'commercial', explanation: 'commercial activity 表示「商业活动」，概括共享经济这一新兴业态。' },
        { stem: '第 2 空', answer: 'emerge', explanation: 'has emerged 表示「已经出现」，与 has 构成现在完成时。' },
        { stem: '第 3 空', answer: 'access', explanation: 'access to... 表示「使用…的权利/机会」，符合「不为拥有而为使用付费」的语境。' },
        { stem: '第 4 空', answer: 'benefit', explanation: 'one clear benefit 表示「一个明显的好处」，冒号后即为具体好处。' },
        { stem: '第 5 空', answer: 'resource', explanation: 'idle resource 表示「闲置资源」，后文举例 spare rooms 与 parked cars。' },
        { stem: '第 6 空', answer: 'flexible', explanation: 'flexible work 表示「弹性工作」，与 cannot take a nine-to-five job 呼应。' },
        { stem: '第 7 空', answer: 'traditional', explanation: 'a traditional nine-to-five job 表示「传统的朝九晚五工作」。' },
        { stem: '第 8 空', answer: 'regulate', explanation: 'the rules that regulate it 表示「监管它的规则」。' },
        { stem: '第 9 空', answer: 'significant', explanation: 'a significant concern 表示「一个重大的担忧」。' },
        { stem: '第 10 空', answer: 'competition', explanation: 'unfair competition 表示「不公平竞争」，正是把本地商家挤出市场的原因。' }
      ]
    },

    {
      id: 'sf_3',
      type: 'select-fill',
      source: 'builtin',
      year: '',
      paper: '原创仿真 · 第 3 套',
      title: 'Sleep and Memory',
      options: [
        'consolidate', 'contribute', 'deprive', 'essential', 'evidence',
        'impair', 'interval', 'maintain', 'process', 'recall',
        'restore', 'schedule', 'sufficient', 'tendency', 'vary'
      ],
      passage: 'It is common for students to sacrifice sleep in order to study more. A large body of [[1]] suggests this is a poor bargain. During deep sleep, the brain [[2]] what it has learned during the day, transferring information from short-term to long-term storage.\n\nWhen people are [[3]] of sleep, their ability to [[4]] new information falls sharply. Interestingly, the effect on memory is stronger than the effect on attention: a tired student can often stay awake and read a page, yet [[5]] very little of it the next morning.\n\nThe amount of sleep needed [[6]] between individuals, but for most adults seven to nine hours is [[7]]. What matters nearly as much is regularity. A stable sleep [[8]] — going to bed and waking at roughly the same times — helps the body [[9]] its internal clock. Students who keep irregular hours, by contrast, report a [[10]] to feel tired during the day even when they have slept for a long time.',
      subQuestions: [
        { stem: '第 1 空', answer: 'evidence', explanation: 'a large body of evidence 表示「大量证据」，为学术写作常用搭配。' },
        { stem: '第 2 空', answer: 'consolidate', explanation: 'consolidate 表示「巩固」，正是睡眠对记忆的作用。' },
        { stem: '第 3 空', answer: 'deprive', explanation: 'deprive sb of sth 表示「剥夺某人的某物」，被动式 be deprived of sleep 即「被剥夺睡眠」。' },
        { stem: '第 4 空', answer: 'recall', explanation: 'recall information 表示「回忆/提取信息」。' },
        { stem: '第 5 空', answer: 'process', explanation: 'process 此处指「处理、理解」，与前文 read 形成对比：读得下却处理不了。' },
        { stem: '第 6 空', answer: 'vary', explanation: 'vary between individuals 表示「因人而异」。' },
        { stem: '第 7 空', answer: 'sufficient', explanation: 'is sufficient 表示「是足够的」。' },
        { stem: '第 8 空', answer: 'schedule', explanation: 'a stable sleep schedule 表示「稳定的作息时间表」。' },
        { stem: '第 9 空', answer: 'maintain', explanation: 'maintain its internal clock 表示「维持其生物钟」。' },
        { stem: '第 10 空', answer: 'tendency', explanation: 'a tendency to feel tired 表示「容易感到疲倦的倾向」。' }
      ]
    }
  );
})(window);
