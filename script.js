// Глобальные переменные
let tg = window.Telegram.WebApp;
let userId = tg.initDataUnsafe?.user?.id || 'test_user';
let currentTab = 'today';
let tasksToday = [];
let habits = [];
let history = {};          // формат: { "2025-02-25": 85, ... }
let tasksHistory = {};     // детальные задачи по дням
let timers = [];

// Для архива (переключение месяцев)
let currentArchiveDate = new Date();

// Инициализация
tg.expand();
tg.enableClosingConfirmation();

// Загружаем данные и запускаем
loadAllData().then(() => {
    checkDayChange().then(() => {
        renderTab(currentTab);
        updateBackground();
    });
});

// Элементы
const contentDiv = document.getElementById('content');
const modal = document.getElementById('modal');
const modalBody = document.getElementById('modal-body');
const closeModal = document.querySelector('.close');

closeModal.onclick = () => modal.style.display = 'none';
window.onclick = (e) => { if (e.target == modal) modal.style.display = 'none'; };

// Обработчики вкладок
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentTab = e.target.dataset.tab;
        renderTab(currentTab);
        // Если переключились на вкладку таймеров, обновим отображение времени
        if (currentTab === 'timers') {
            updateTimersDisplay();
        }
    });
});

// Загрузка всех данных из CloudStorage
async function loadAllData() {
    if (tg.CloudStorage) {
        try {
            let tasksStr = await getCloudItem('tasks_today');
            tasksToday = tasksStr ? JSON.parse(tasksStr) : [];

            let habitsStr = await getCloudItem('habits');
            habits = habitsStr ? JSON.parse(habitsStr) : [];

            let historyStr = await getCloudItem('history');
            history = historyStr ? JSON.parse(historyStr) : {};

            let tasksHistoryStr = await getCloudItem('tasks_history');
            tasksHistory = tasksHistoryStr ? JSON.parse(tasksHistoryStr) : {};
        } catch (e) {
            console.error('Ошибка загрузки', e);
        }
    } else {
        // Эмуляция для теста вне Telegram
        tasksToday = [];
        habits = [];
        history = {};
        tasksHistory = {};
    }
}

function getCloudItem(key) {
    return new Promise((resolve) => {
        tg.CloudStorage.getItem(key, (err, value) => {
            if (err) resolve(null);
            else resolve(value);
        });
    });
}

function setCloudItem(key, value) {
    return new Promise((resolve) => {
        tg.CloudStorage.setItem(key, JSON.stringify(value), (err, ok) => {
            resolve(ok);
        });
    });
}

// Проверка смены дня
async function checkDayChange() {
    let lastUpdateStr = await getCloudItem('last_update');
    let today = new Date().toISOString().split('T')[0];

    if (lastUpdateStr !== today) {
        // Завершаем вчерашний день, если он был
        if (lastUpdateStr) {
            let totalWeight = tasksToday.filter(t => t.completed).reduce((sum, t) => sum + t.weight, 0);
            history[lastUpdateStr] = totalWeight;
            await setCloudItem('history', history);

            // Сохраняем детальные задачи за вчера
            tasksHistory[lastUpdateStr] = tasksToday.map(t => ({
                name: t.name,
                weight: t.weight,
                completed: t.completed,
                timeOfDay: t.timeOfDay
            }));
            await setCloudItem('tasks_history', tasksHistory);
        }

        // Генерируем новый день из привычек
        generateTodayFromHabits();

        // Сохраняем обновлённые задачи и дату
        await setCloudItem('tasks_today', tasksToday);
        await setCloudItem('last_update', today);
    } else {
        // День не сменился, просто загружаем задачи (уже загружены в loadAllData)
    }
}

// Генерация задач на сегодня из привычек
function generateTodayFromHabits() {
    tasksToday = [];
    let today = new Date();
    let dayOfWeek = today.getDay(); // 0 вс

    habits.forEach(habit => {
        if (shouldHabitAppearToday(habit)) {
            tasksToday.push({
                id: Date.now() + Math.random() + (habit.id || Math.random()),
                name: habit.name,
                weight: habit.weight,
                timeOfDay: habit.timeOfDay,
                completed: false
            });
        }
    });
}

// Проверка, должна ли привычка появиться сегодня
function shouldHabitAppearToday(habit) {
    let today = new Date();
    let dayOfWeek = today.getDay();
    if (habit.schedule.type === 'daily') {
        return true;
    } else if (habit.schedule.type === 'weekly') {
        return habit.schedule.days.includes(dayOfWeek);
    }
    return false;
}

// Добавить задачу из привычки в сегодняшний список (если её там ещё нет)
function addTaskFromHabit(habit) {
    // Проверяем, есть ли уже задача с таким именем (грубо, но для простоты сойдёт)
    let exists = tasksToday.some(t => t.name === habit.name && t.timeOfDay === habit.timeOfDay);
    if (!exists) {
        tasksToday.push({
            id: Date.now() + Math.random(),
            name: habit.name,
            weight: habit.weight,
            timeOfDay: habit.timeOfDay,
            completed: false
        });
    }
}

// Удалить задачу из сегодняшнего списка (если она там есть)
function removeTaskFromHabit(habit) {
    tasksToday = tasksToday.filter(t => !(t.name === habit.name && t.timeOfDay === habit.timeOfDay));
}

// Обновить задачу в сегодняшнем списке (если она изменилась)
function updateTaskFromHabit(oldHabit, newHabit) {
    // Сначала удаляем старую задачу, потом добавляем новую, если должна появиться
    removeTaskFromHabit(oldHabit);
    if (shouldHabitAppearToday(newHabit)) {
        addTaskFromHabit(newHabit);
    }
}

// Отрисовка текущей вкладки
function renderTab(tab) {
    switch(tab) {
        case 'today': renderToday(); break;
        case 'habits': renderHabits(); break;
        case 'timers': renderTimers(); break;
        case 'archive': renderArchive(); break;
    }
}

// ==================== ВКЛАДКА СЕГОДНЯ ====================
function renderToday() {
    let groups = { morning: [], afternoon: [], evening: [] };
    tasksToday.forEach(task => groups[task.timeOfDay]?.push(task));

    let html = '';
    const times = {
        morning: 'Утро',
        afternoon: 'День',
        evening: 'Вечер'
    };

    for (let [key, title] of Object.entries(times)) {
        if (groups[key].length > 0) {
            html += `<div class="task-group"><div class="group-title">${title}</div>`;
            groups[key].forEach(task => {
                html += `
                    <div class="task-item ${task.completed ? 'completed' : ''}" data-id="${task.id}">
                        <div class="task-checkbox ${task.completed ? 'checked' : ''}" data-id="${task.id}"></div>
                        <span class="task-name">${task.name}</span>
                        <span class="task-weight">${task.weight}%</span>
                    </div>
                `;
            });
            html += '</div>';
        }
    }

    html += `<button class="add-button" onclick="showAddTaskModal()">+ Добавить задачу</button>`;
    contentDiv.innerHTML = html;

    document.querySelectorAll('.task-checkbox').forEach(cb => {
        cb.addEventListener('click', (e) => {
            let id = e.target.dataset.id;
            let task = tasksToday.find(t => t.id == id);
            if (task) {
                task.completed = !task.completed;
                // Сохраняем
                setCloudItem('tasks_today', tasksToday);
                renderToday();
                updateBackground();
                if (task.completed) tg.HapticFeedback.impactOccurred('medium');
            }
        });
    });
}

function showAddTaskModal() {
    modalBody.innerHTML = `
        <h3>Новая задача</h3>
        <div class="form-group">
            <label>Название</label>
            <input type="text" id="task-name" placeholder="">
        </div>
        <div class="form-group">
            <label>Вес (%)</label>
            <input type="number" id="task-weight" value="50" min="1">
        </div>
        <div class="form-group">
            <label>Часть дня</label>
            <select id="task-time">
                <option value="morning">Утро</option>
                <option value="afternoon">День</option>
                <option value="evening">Вечер</option>
            </select>
        </div>
        <div class="form-actions">
            <button class="btn-primary" onclick="addTask()">Добавить</button>
            <button class="btn-secondary" onclick="closeModal()">Отмена</button>
        </div>
    `;
    modal.style.display = 'flex';
}

window.addTask = function() {
    let name = document.getElementById('task-name').value.trim();
    let weight = parseInt(document.getElementById('task-weight').value) || 1;
    let time = document.getElementById('task-time').value;

    if (!name) return;

    tasksToday.push({
        id: Date.now(),
        name,
        weight,
        timeOfDay: time,
        completed: false
    });

    setCloudItem('tasks_today', tasksToday);
    modal.style.display = 'none';
    renderToday();
    updateBackground();
};

// ==================== ВКЛАДКА ПРИВЫЧКИ ====================
function renderHabits() {
    let html = '<div class="habits-list">';
    habits.forEach((habit, index) => {
        let scheduleText = habit.schedule.type === 'daily' ? 'Каждый день' :
            `По дням: ${habit.schedule.days.map(d => ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'][d]).join(', ')}`;
        html += `
            <div class="habit-item">
                <div class="habit-info">
                    <div class="habit-name">${habit.name}</div>
                    <div class="habit-details">${habit.weight}% · ${scheduleText} · ${habit.timeOfDay === 'morning' ? 'Утро' : habit.timeOfDay === 'afternoon' ? 'День' : 'Вечер'}</div>
                </div>
                <div class="habit-actions">
                    <button class="habit-edit" onclick="editHabit(${index})">✏️</button>
                    <button class="habit-delete" onclick="deleteHabit(${index})">🗑️</button>
                </div>
            </div>
        `;
    });
    html += '</div>';
    html += `<button class="add-button" onclick="showAddHabitModal()">+ Добавить привычку</button>`;
    contentDiv.innerHTML = html;
}

function showAddHabitModal(existingIndex = null) {
    let habit = existingIndex !== null ? habits[existingIndex] : null;

    modalBody.innerHTML = `
        <h3>${habit ? 'Редактировать' : 'Новая'} привычка</h3>
        <div class="form-group">
            <label>Название</label>
            <input type="text" id="habit-name" value="${habit ? habit.name : ''}">
        </div>
        <div class="form-group">
            <label>Вес (%)</label>
            <input type="number" id="habit-weight" value="${habit ? habit.weight : 50}" min="1">
        </div>
        <div class="form-group">
            <label>Часть дня</label>
            <select id="habit-time">
                <option value="morning" ${habit && habit.timeOfDay === 'morning' ? 'selected' : ''}>Утро</option>
                <option value="afternoon" ${habit && habit.timeOfDay === 'afternoon' ? 'selected' : ''}>День</option>
                <option value="evening" ${habit && habit.timeOfDay === 'evening' ? 'selected' : ''}>Вечер</option>
            </select>
        </div>
        <div class="form-group">
            <label>Тип расписания</label>
            <select id="schedule-type" onchange="toggleScheduleDays()">
                <option value="daily" ${habit && habit.schedule.type === 'daily' ? 'selected' : ''}>Каждый день</option>
                <option value="weekly" ${habit && habit.schedule.type === 'weekly' ? 'selected' : ''}>По дням недели</option>
            </select>
        </div>
        <div id="weekly-days" style="display: ${habit && habit.schedule.type === 'weekly' ? 'block' : 'none'};">
            <div class="form-group">
                <label>Дни недели (0-6, вс=0)</label>
                <input type="text" id="weekly-days-input" placeholder="например 1,3,5 для Пн,Ср,Пт" value="${habit && habit.schedule.days ? habit.schedule.days.join(',') : ''}">
            </div>
        </div>
        <div class="form-actions">
            <button class="btn-primary" onclick="saveHabit(${existingIndex})">Сохранить</button>
            <button class="btn-secondary" onclick="closeModal()">Отмена</button>
        </div>
    `;
    modal.style.display = 'flex';
}

window.toggleScheduleDays = function() {
    let type = document.getElementById('schedule-type').value;
    document.getElementById('weekly-days').style.display = type === 'weekly' ? 'block' : 'none';
};

window.saveHabit = async function(index) {
    let name = document.getElementById('habit-name').value.trim();
    let weight = parseInt(document.getElementById('habit-weight').value) || 1;
    let time = document.getElementById('habit-time').value;
    let type = document.getElementById('schedule-type').value;
    let days = [];
    if (type === 'weekly') {
        let input = document.getElementById('weekly-days-input').value;
        days = input.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n >=0 && n <=6);
    }

    if (!name) return;

    let newHabit = {
        id: index !== null && habits[index] ? habits[index].id : Date.now(),
        name,
        weight,
        timeOfDay: time,
        schedule: { type, days }
    };

    if (index !== null) {
        // Редактирование: обновляем привычку и связанные задачи
        let oldHabit = habits[index];
        habits[index] = newHabit;
        updateTaskFromHabit(oldHabit, newHabit);
    } else {
        // Новая привычка
        habits.push(newHabit);
        if (shouldHabitAppearToday(newHabit)) {
            addTaskFromHabit(newHabit);
        }
    }

    // Сохраняем всё
    await setCloudItem('habits', habits);
    await setCloudItem('tasks_today', tasksToday);
    modal.style.display = 'none';
    renderHabits();
    if (currentTab === 'today') renderToday();
    updateBackground();
};

window.deleteHabit = async function(index) {
    if (confirm('Удалить привычку?')) {
        let oldHabit = habits[index];
        habits.splice(index, 1);
        removeTaskFromHabit(oldHabit);
        await setCloudItem('habits', habits);
        await setCloudItem('tasks_today', tasksToday);
        renderHabits();
        if (currentTab === 'today') renderToday();
        updateBackground();
    }
};

window.editHabit = function(index) {
    showAddHabitModal(index);
};

// ==================== ВКЛАДКА ТАЙМЕРЫ (исправлено) ====================
function renderTimers() {
    let html = '<div class="timers-list" id="timers-list">';
    timers.forEach((timer, idx) => {
        let remaining = timer.remaining !== undefined ? timer.remaining : timer.duration * 60;
        let mins = Math.floor(remaining / 60);
        let secs = remaining % 60;
        html += `
            <div class="timer-item" data-idx="${idx}" id="timer-${idx}">
                <div class="timer-header">
                    <span class="timer-name">${timer.name}</span>
                    <span class="timer-time" id="timer-time-${idx}">${mins}:${secs < 10 ? '0' : ''}${secs}</span>
                </div>
                <div class="timer-controls">
                    <button class="timer-start ${timer.interval ? 'running' : ''}" data-idx="${idx}">${timer.interval ? 'Пауза' : 'Старт'}</button>
                    <button class="timer-stop" data-idx="${idx}">Стоп</button>
                    <button class="timer-delete" data-idx="${idx}">Удалить</button>
                </div>
            </div>
        `;
    });
    html += '</div>';
    html += `<button class="add-button" onclick="showAddTimerModal()">+ Добавить таймер</button>`;
    contentDiv.innerHTML = html;

    // Обработчики
    document.querySelectorAll('.timer-start').forEach(btn => {
        btn.addEventListener('click', (e) => {
            let idx = e.target.dataset.idx;
            toggleTimer(idx);
        });
    });
    document.querySelectorAll('.timer-stop').forEach(btn => {
        btn.addEventListener('click', (e) => {
            let idx = e.target.dataset.idx;
            stopTimer(idx);
        });
    });
    document.querySelectorAll('.timer-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            let idx = e.target.dataset.idx;
            deleteTimer(idx);
        });
    });
}

// Функция обновления отображения времени для всех таймеров (без перерисовки)
function updateTimersDisplay() {
    if (currentTab !== 'timers') return; // не обновляем, если не на вкладке таймеров
    timers.forEach((timer, idx) => {
        let remaining = timer.remaining !== undefined ? timer.remaining : timer.duration * 60;
        let mins = Math.floor(remaining / 60);
        let secs = remaining % 60;
        let timeSpan = document.getElementById(`timer-time-${idx}`);
        if (timeSpan) {
            timeSpan.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
        }
    });
}

function showAddTimerModal() {
    modalBody.innerHTML = `
        <h3>Новый таймер</h3>
        <div class="form-group">
            <label>Название</label>
            <input type="text" id="timer-name" placeholder="">
        </div>
        <div class="form-group">
            <label>Длительность (минуты)</label>
            <input type="number" id="timer-duration" value="25" min="1">
        </div>
        <div class="form-actions">
            <button class="btn-primary" onclick="addTimer()">Добавить</button>
            <button class="btn-secondary" onclick="closeModal()">Отмена</button>
        </div>
    `;
    modal.style.display = 'flex';
}

window.addTimer = function() {
    let name = document.getElementById('timer-name').value.trim();
    let duration = parseInt(document.getElementById('timer-duration').value) || 25;
    if (!name) return;

    timers.push({
        name,
        duration,
        remaining: duration * 60,
        interval: null
    });
    saveTimersToLocal();
    modal.style.display = 'none';
    renderTimers();
};

function toggleTimer(idx) {
    let timer = timers[idx];
    if (timer.interval) {
        clearInterval(timer.interval);
        timer.interval = null;
    } else {
        if (timer.remaining <= 0) timer.remaining = timer.duration * 60;
        timer.interval = setInterval(() => {
            timer.remaining--;
            if (timer.remaining <= 0) {
                clearInterval(timer.interval);
                timer.interval = null;
                timer.remaining = 0;
                tg.HapticFeedback.notificationOccurred('success');
            }
            // Обновляем отображение, только если активна вкладка таймеров
            if (currentTab === 'timers') {
                updateTimersDisplay();
            }
        }, 1000);
    }
    saveTimersToLocal();
    // Обновим кнопку Старт/Пауза
    if (currentTab === 'timers') {
        renderTimers(); // перерисуем, чтобы обновить класс кнопки
    }
}

function stopTimer(idx) {
    let timer = timers[idx];
    if (timer.interval) {
        clearInterval(timer.interval);
        timer.interval = null;
    }
    timer.remaining = timer.duration * 60;
    saveTimersToLocal();
    if (currentTab === 'timers') {
        renderTimers();
    }
}

function deleteTimer(idx) {
    if (timers[idx].interval) clearInterval(timers[idx].interval);
    timers.splice(idx, 1);
    saveTimersToLocal();
    if (currentTab === 'timers') {
        renderTimers();
    }
}

function saveTimersToLocal() {
    localStorage.setItem('timers', JSON.stringify(timers));
}

// Загружаем таймеры при старте
let savedTimers = localStorage.getItem('timers');
if (savedTimers) {
    timers = JSON.parse(savedTimers);
    timers.forEach(t => {
        if (t.remaining === undefined) t.remaining = t.duration * 60;
        t.interval = null; // интервалы не сохраняем
    });
}

// ==================== ВКЛАДКА АРХИВ ====================
function renderArchive() {
    let year = currentArchiveDate.getFullYear();
    let month = currentArchiveDate.getMonth();

    let firstDay = new Date(year, month, 1);
    let startDay = firstDay.getDay(); // 0 вс
    let daysInMonth = new Date(year, month + 1, 0).getDate();

    let monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    let monthName = monthNames[month];

    let html = `
        <div class="calendar-header">
            <button class="month-nav" onclick="changeMonth(-1)">◀</button>
            <span class="calendar-month">${monthName} ${year}</span>
            <button class="month-nav" onclick="changeMonth(1)">▶</button>
        </div>
        <div class="calendar-grid">
    `;

    // Пустые ячейки до первого дня
    for (let i = 0; i < startDay; i++) {
        html += `<div class="calendar-day empty"></div>`;
    }

    for (let d = 1; d <= daysInMonth; d++) {
        let dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        let percent = history[dateStr] || 0;
        let brightness = Math.min(255, Math.floor(255 * percent / 100));
        let color = `rgb(${brightness}, ${brightness}, ${brightness})`;
        let textColor = brightness > 128 ? '#000' : '#fff';
        html += `<div class="calendar-day" style="background: ${color}; color: ${textColor};" onclick="showDayDetails('${dateStr}')">${d}</div>`;
    }

    html += '</div>';
    contentDiv.innerHTML = html;
}

window.changeMonth = function(delta) {
    currentArchiveDate.setMonth(currentArchiveDate.getMonth() + delta);
    renderArchive();
};

window.showDayDetails = function(dateStr) {
    let percent = history[dateStr] || 0;
    let tasks = tasksHistory[dateStr] || [];
    let tasksHtml = tasks.length ? tasks.map(t => `${t.name} (${t.weight}%) ${t.completed ? '✅' : '❌'}`).join('<br>') : 'Нет задач';
    modalBody.innerHTML = `
        <h3>${dateStr}</h3>
        <p>Прогресс: ${percent}%</p>
        <div>${tasksHtml}</div>
        <div class="form-actions">
            <button class="btn-primary" onclick="closeModal()">OK</button>
        </div>
    `;
    modal.style.display = 'flex';
};

// ==================== ОБНОВЛЕНИЕ ФОНА ====================
function updateBackground() {
    let total = tasksToday.reduce((sum, t) => sum + (t.completed ? t.weight : 0), 0);
    let brightness = Math.min(255, Math.floor(255 * total / 100));
    let bgColor = `rgb(${brightness}, ${brightness}, ${brightness})`;
    document.body.style.backgroundColor = bgColor;

    let content = document.querySelector('.content');
    if (content) {
        if (brightness > 128) {
            content.classList.remove('light-text');
            content.classList.add('dark-text');
        } else {
            content.classList.remove('dark-text');
            content.classList.add('light-text');
        }
    }

    // Божественное свечение
    let appDiv = document.querySelector('.app');
    if (appDiv) {
        if (total > 100) {
            appDiv.classList.add('divine-glow');
        } else {
            appDiv.classList.remove('divine-glow');
        }
    }
}

// Закрытие модалки
window.closeModal = function() {
    modal.style.display = 'none';
};
