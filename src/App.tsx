import { useState, useEffect, useRef } from 'react';

const USERS = ['张天皓', '王星宇', '洛松江村'];

// Bmob 数据库配置 (联机核心)
const BMOB_APP_ID = "8fe7385f5b6e964856699deae7d9ce4d";
const BMOB_REST_KEY = "4d82d9e9b980b2a0e4891baff2956111";
const BMOB_HEADERS = {
  "X-Bmob-Application-Id": BMOB_APP_ID,
  "X-Bmob-REST-API-Key": BMOB_REST_KEY,
  "Content-Type": "application/json"
};

const TIME_SLOTS = Array.from({ length: 12 }).map((_, i) => {
  let startHour = 8 + i * 2;
  let endHour = startHour + 2;
  const isNextDay = startHour >= 24;

  const displayStart = startHour >= 24 ? startHour - 24 : startHour;
  const displayEnd = endHour >= 24 ? endHour - 24 : endHour;

  const start = `${displayStart.toString().padStart(2, '0')}:00`;
  const end = `${displayEnd.toString().padStart(2, '0')}:00`;

  return {
    id: `h${startHour}`,
    startLabel: start,
    endLabel: end,
    isNextDay,
    startHour
  };
});

const generateDates = () => {
  const dates = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);

    const absoluteDateId = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dateStr = `${d.getMonth() + 1}月${d.getDate()}日`;
    const dayStr = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    dates.push({
      id: absoluteDateId,
      label: dateStr,
      dayLabel: i === 0 ? '(今天)' : `(${dayStr})`,
      isToday: i === 0
    });
  }
  return dates;
};

// Gemini API 集成
const callGeminiApi = async (prompt: string) => {
  const apiKey = ""; // 在此沙盒环境中，系统底层会自动注入密钥
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

  const attemptFetch = async (retries: number, delay: number): Promise<string> => {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          systemInstruction: {
            parts: [{ text: "你是一个幽默、机智的共享账号管理助理。你的服务对象是三个中国大学室友：张天皓、王星宇、洛松江村。回复请使用中文，语气要像年轻朋友一样，可以带点网络梗和吐槽。" }]
          }
        })
      });
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "AI 似乎睡着了，没有返回内容。";
    } catch (error) {
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
        return attemptFetch(retries - 1, delay * 2);
      }
      throw error;
    }
  };

  return attemptFetch(5, 1000);
};

export default function App() {
  const [currentUser, setCurrentUser] = useState(USERS[0]);
  const [dates, setDates] = useState<Array<{id: string, label: string, dayLabel: string, isToday: boolean}>>([]);
  const [reservations, setReservations] = useState<Record<string, string>>({});
  const [toastMessage, setToastMessage] = useState('');
  const [objectId, setObjectId] = useState<string | null>(null);

  const isOffline = useRef(false);

  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiModal, setAiModal] = useState<{ isOpen: boolean, title: string, content: string }>({ isOpen: false, title: '', content: '' });
  const [conflictModal, setConflictModal] = useState<{ isOpen: boolean, dateId: string, slotId: string, reserver: string }>({ isOpen: false, dateId: '', slotId: '', reserver: '' });

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  };

  // 获取云端数据
  const fetchReservations = async () => {
    if (isOffline.current) return;

    try {
      const res = await fetch("https://api.bmob.cn/1/classes/SharedSchedule?limit=1", { headers: BMOB_HEADERS });
      if (!res.ok) {
         throw new Error(`HTTP Error: ${res.status}`);
      }

      const data = await res.json();
      if (data.results && data.results.length > 0) {
        setReservations(data.results[0].data || {});
        setObjectId(data.results[0].objectId);
      } else {
        const createRes = await fetch("https://api.bmob.cn/1/classes/SharedSchedule", {
          method: "POST",
          headers: BMOB_HEADERS,
          body: JSON.stringify({ data: {} })
        });
        const createData = await createRes.json();
        setObjectId(createData.objectId);
      }
    } catch (e) {
      if (!isOffline.current) {
        isOffline.current = true;
        showToast("由于沙盒环境限制，已为您平滑切换至本地预览模式");
      }
    }
  };

  // 推送数据到云端
  const syncToCloud = async (newData: Record<string, string>, currentObjectId: string | null) => {
    if (!currentObjectId || isOffline.current) return;
    try {
      const res = await fetch(`https://api.bmob.cn/1/classes/SharedSchedule/${currentObjectId}`, {
        method: "PUT",
        headers: BMOB_HEADERS,
        body: JSON.stringify({ data: newData })
      });
      if (!res.ok) throw new Error('Sync failed');
    } catch (e) {
      // 静默处理，不中断本地操作
    }
  };

  useEffect(() => {
    setDates(generateDates());
    fetchReservations();
    const interval = setInterval(fetchReservations, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleToggleReservation = (dateId: string, slotId: string) => {
    const key = `${dateId}-${slotId}`;
    const currentReserver = reservations[key];

    if (currentReserver === currentUser) {
      const newReservations = { ...reservations };
      delete newReservations[key];
      setReservations(newReservations);
      syncToCloud(newReservations, objectId);
    } else if (!currentReserver) {
      const userSlotsOnDate = Object.entries(reservations).filter(
        ([k, v]) => k.startsWith(`${dateId}-`) && v === currentUser
      ).length;

      if (userSlotsOnDate >= 3) {
        showToast('每天最多只能预约 6 个小时（3个时段）哦！');
        return;
      }

      const newReservations = { ...reservations, [key]: currentUser };
      setReservations(newReservations);
      syncToCloud(newReservations, objectId);
    } else {
      setConflictModal({ isOpen: true, dateId, slotId, reserver: currentReserver });
    }
  };

  const generateScheduleSummary = async () => {
    setIsAiLoading(true);
    setAiModal({ isOpen: true, title: '✨ AI 智能排班吐槽周报', content: '' });

    const scheduleData = Object.entries(reservations).map(([key, user]) => {
      const [date, slot] = key.split('-');
      return `${date} ${slot.replace('h', '')}:00 归 ${user}`;
    }).join(', ');

    const prompt = scheduleData
      ? `这是本周我们的共享账号预约情况：${scheduleData}。请简短地总结一下大家的偏好。比如谁是卷王？谁最爱熬夜？谁都没怎么用？用幽默搞笑的口吻评价一下这三个人的排班，并给大家本周的观影/游戏推荐一个共同的主题。字数200字左右。`
      : `现在本周的排班表还是空的！请用夸张、搞笑的口吻催促三个室友（张天皓, 王星宇, 洛松江村）赶紧来抢占账号，顺便推荐几部近期热门的电影或游戏激起他们的欲望。字数200字左右。`;

    try {
      const response = await callGeminiApi(prompt);
      setAiModal({ isOpen: true, title: '✨ AI 智能排班吐槽周报', content: response });
    } catch (e) {
      setAiModal({ isOpen: true, title: '错误', content: 'AI 接口请求失败，请稍后再试。' });
    } finally {
      setIsAiLoading(false);
    }
  };

  const generateNegotiationMessage = async () => {
    const { dateId, slotId, reserver } = conflictModal;
    setConflictModal({ ...conflictModal, isOpen: false });

    setIsAiLoading(true);
    setAiModal({ isOpen: true, title: '✨ AI 高情商代写 (复制发微信吧)', content: '' });

    const prompt = `我（${currentUser}）特别想在 ${dateId} 的 ${slotId.replace('h', '')}:00 这个时间段使用共享账号，但是已经被我的室友 ${reserver} 预约了。请帮我写一段发给 ${reserver} 的微信消息，求他把这个时间段让给我。要求：高情商、极其幽默、可以适当卖惨或带点室友间的搞笑撒娇，不超过60个字。`;

    try {
      const response = await callGeminiApi(prompt);
      setAiModal({ isOpen: true, title: `✨ 专门发给 ${reserver} 的求让话术`, content: response });
    } catch (e) {
      setAiModal({ isOpen: true, title: '错误', content: 'AI 接口请求失败，请稍后再试。' });
    } finally {
      setIsAiLoading(false);
    }
  };

  const copyToClipboard = () => {
    const textArea = document.createElement("textarea");
    textArea.value = aiModal.content;
    document.body.appendChild(textArea);
    textArea.select();
    try {
      navigator.clipboard.writeText(aiModal.content);
      showToast('已复制到剪贴板！快去发给室友吧');
    } catch (err) {
      document.execCommand('copy');
      showToast('已复制到剪贴板！快去发给室友吧');
    }
    document.body.removeChild(textArea);
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] p-2 md:p-6 font-sans text-gray-800">
      <div className="max-w-[1200px] mx-auto bg-white rounded-xl shadow-[0_2px_10px_rgba(0,0,0,0.04)] border border-gray-100 overflow-hidden relative">

        {/* Header */}
        <div className="p-5 border-b border-gray-100 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-white">
          <h1 className="text-xl font-bold text-gray-800 tracking-tight flex items-center gap-2">
            共享账号预约系统
            <button
              onClick={generateScheduleSummary}
              className="text-xs ml-2 bg-gradient-to-r from-purple-500 to-indigo-500 text-white px-3 py-1.5 rounded-full hover:shadow-md hover:scale-105 transition-all flex items-center gap-1 font-medium"
            >
              ✨ AI 排班周报
            </button>
          </h1>
          <div className="flex items-center gap-3 self-end lg:self-auto">
            <span className="text-sm font-medium text-gray-500">当前操作人:</span>
            <div className="flex bg-gray-100/80 p-1 rounded-lg border border-gray-200/50">
              {USERS.map(user => (
                <button
                  key={user}
                  onClick={() => setCurrentUser(user)}
                  className={`px-3 md:px-4 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
                    currentUser === user
                      ? 'bg-white text-blue-600 shadow-sm border border-gray-200/50'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {user}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Toast Notification */}
        {toastMessage && (
          <div className="bg-blue-50 border border-blue-100 text-blue-600 px-4 py-2.5 mx-5 mt-5 rounded-lg flex items-center gap-2 animate-pulse">
            <span className="text-sm font-medium">{toastMessage}</span>
          </div>
        )}

        {/* Timetable */}
        <div className="p-5">
          <div className="overflow-x-auto rounded-xl border border-gray-100 shadow-sm">
            <table className="w-full text-left border-collapse min-w-max select-none bg-white">
              <thead>
                <tr>
                  <th className="p-4 text-sm font-bold text-gray-700 bg-[#fafafa] border-b border-r border-gray-100 sticky left-0 z-10 w-28 md:w-36 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                    日期
                  </th>
                  {TIME_SLOTS.map((slot) => (
                    <th key={slot.id} className="p-3 text-center bg-[#fafafa] border-b border-gray-100 min-w-[90px]">
                      <div className="text-[15px] font-bold text-gray-800 tracking-tight">{slot.startLabel}</div>
                      <div className="text-[12px] text-gray-400 font-normal mt-0.5">{slot.endLabel}</div>
                      {slot.isNextDay && <div className="text-[10px] text-orange-500 font-normal mt-1 bg-orange-50 inline-block px-1.5 py-0.5 rounded leading-none">次日</div>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dates.map((date) => (
                  <tr key={date.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/50 transition-colors">
                    <td className="p-4 text-sm font-medium bg-white border-r border-gray-100 sticky left-0 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                      <div className={`flex flex-col md:flex-row md:gap-1.5 ${date.isToday ? 'text-[#3b82f6]' : 'text-gray-700'}`}>
                        <span>{date.label}</span>
                        <span>{date.dayLabel}</span>
                      </div>
                    </td>
                    {TIME_SLOTS.map((slot) => {
                      const key = `${date.id}-${slot.id}`;
                      const reserver = reservations[key];
                      const isCurrentUser = reserver === currentUser;

                      let userBgClass = '';
                      if (reserver === '张天皓') userBgClass = 'bg-blue-50 text-blue-600 border-blue-200';
                      else if (reserver === '王星宇') userBgClass = 'bg-emerald-50 text-emerald-600 border-emerald-200';
                      else if (reserver === '洛松江村') userBgClass = 'bg-violet-50 text-violet-600 border-violet-200';

                      return (
                        <td key={slot.id} className="p-2 text-center">
                          <button
                            onClick={() => handleToggleReservation(date.id, slot.id)}
                            className={`w-[72px] h-[40px] flex items-center justify-center text-[13px] font-medium rounded-md transition-all mx-auto border
                              ${reserver
                                ? `${userBgClass} border-solid shadow-sm`
                                : 'bg-transparent border-dashed border-gray-200 text-gray-400 hover:border-[#3b82f6] hover:text-[#3b82f6] hover:bg-blue-50/30'
                              }
                              ${isCurrentUser ? 'ring-2 ring-offset-1 ring-blue-300' : ''}
                            `}
                          >
                            {reserver ? reserver : '可约'}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 冲突处理 Modal */}
        {conflictModal.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 transform transition-all">
              <h3 className="text-lg font-bold text-gray-900 mb-2">哎呀，被抢先了！</h3>
              <p className="text-sm text-gray-600 mb-6">
                该时段已被 <strong className="text-gray-900">{conflictModal.reserver}</strong> 预约。你可以选择换个时间，或者让 AI 帮你写一段高情商的消息去微信"讨要"一下？
              </p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={generateNegotiationMessage}
                  className="w-full bg-gradient-to-r from-purple-500 to-indigo-500 text-white font-medium py-2.5 rounded-lg hover:shadow-lg hover:opacity-90 transition-all flex justify-center items-center gap-2"
                >
                  ✨ AI 代写"求让"话术
                </button>
                <button
                  onClick={() => setConflictModal({ ...conflictModal, isOpen: false })}
                  className="w-full bg-gray-100 text-gray-700 font-medium py-2.5 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  算了，我换个时间
                </button>
              </div>
            </div>
          </div>
        )}

        {/* AI 结果呈现 Modal */}
        {aiModal.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 flex flex-col max-h-[80vh]">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  {aiModal.title}
                </h3>
                <button
                  onClick={() => setAiModal({ ...aiModal, isOpen: false })}
                  className="text-gray-400 hover:text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-full p-1.5 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto mb-4 min-h-[100px] p-4 bg-purple-50/50 rounded-xl border border-purple-100/50 text-gray-700 text-sm leading-relaxed whitespace-pre-wrap">
                {isAiLoading ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-purple-500 py-6">
                    <svg className="animate-spin h-8 w-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span className="animate-pulse font-medium">Gemini AI 正在努力思考中...</span>
                  </div>
                ) : (
                  aiModal.content
                )}
              </div>

              {!isAiLoading && (
                <div className="flex justify-end gap-3 mt-auto pt-2">
                  {aiModal.title.includes('代写') && (
                    <button
                      onClick={copyToClipboard}
                      className="bg-purple-100 text-purple-700 hover:bg-purple-200 px-4 py-2 rounded-lg font-medium transition-colors text-sm"
                    >
                      复制发微信
                    </button>
                  )}
                  <button
                    onClick={() => setAiModal({ ...aiModal, isOpen: false })}
                    className="bg-gray-900 text-white hover:bg-gray-800 px-5 py-2 rounded-lg font-medium transition-colors text-sm shadow-md"
                  >
                    好勒 / 知道啦
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
