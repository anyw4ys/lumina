// Глобальные переменные
let tg = window.Telegram.WebApp;
let userId = tg.initDataUnsafe?.user?.id || 'test_user'; // для теста без телеграма
let currentTab = 'today';
let tasksToday = [];
let habits = [];
let history = {};
let timers = [];
let timerIntervals = {};

// Инициализация
tg.expand(); // развернуть на весь экран
tg.enableClosingConfirmation(); // спросить при закрытии

// Загружаем данные из CloudStorage
loadAllData().then(() => {
    checkDayChange();
    renderTab(currentTab);
    updateBackground();
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
    });
});

// Загрузка всех данных из CloudStorage
async function loadAllData() {
    // Пытаемся получить данные из CloudStorage Telegram
    if (tg.CloudStorage) {
        try {
            let tasksStr = await getCloudItem('tasks_today');
            tasksToday = tasksStr ? JSON.parse(tasksStr) : [];
            
            let habitsStr = await getCloudItem('habits');
            habits = habitsStr ? JSON.parse(habitsStr) : [];
            
            let historyStr = await getCloudItem('history');
            history = historyStr ? JSON.parse(historyStr) : {};
        } catch (e) {
            console.error('Ошибка загрузки', e);
            // По умолчанию пусто
        }
    } else {
        // Эмуляция для теста вне Telegram
        tasksToday = [];
        habits = [];
        history = {};
    }
}

// Получить элемент из CloudStorage (промис)
function getCloudItem(key) {
    return new Promise((resolve) => {
        tg.CloudStorage.getItem(key, (err, value) => {
            if (err) resolve(null);
            else resolve(value);
        });
    });
}

// Сохранить элемент в CloudStorage
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
        // Завершаем вчерашний день
        if (lastUpdateStr) {
            let totalWeight = tasksToday.filter(t => t.completed).reduce((sum, t) => sum + t.weight, 0);
            history[lastUpdateStr] = totalWeight;
            await setCloudItem('history', history);
        }
        
        // Генерируем новый день
        generateTodayFromHabits();
        
        // Сохраняем обновлённые задачи и дату
        await setCloudItem('tasks_today', tasksToday);
        await setCloudItem('last_update', today);
    } else {
        // День не сменился, просто загружаем задачи
        tasksToday = await getCloudItem('tasks_today') ? JSON.parse(await getCloudItem('tasks_today')) : [];
    }
}

// Генерация задач на сегодня из привычек
function generateTodayFromHabits() {
    tasksToday = [];
    let today = new Date();
    let dayOfWeek = today.getDay(); // 0 вс, 1 пн, ..., 6 сб
    
    habits.forEach(habit => {
        // Проверяем расписание
        let shouldAppear = false;
        if (habit.schedule.type === 'daily') {
            shouldAppear = true;
        } else if (habit.schedule.type === 'weekly') {
            // В weekly храним массив дней (0-6)
            if (habit.schedule.days.includes(dayOfWeek)) shouldAppear = true;
        }
        
        if (shouldAppear) {
            tasksToday.push({
                id: Date.now() + Math.random() + habit.id, // уникальный id
                name: habit.name,
                weight: habit.weight,
                timeOfDay: habit.timeOfDay,
                completed: false
            });
        }
    });
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
        morning: '🌅 Утро',
        afternoon: '☀️ День',
        evening: '🌙 Вечер'
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
    
    // Обработчики чекбоксов
    document.querySelectorAll('.task-checkbox').forEach(cb => {
        cb.addEventListener('click', (e) => {
            let id = e.target.dataset.id;
            let task = tasksToday.find(t => t.id == id);
            if (task) {
                task.completed = !task.completed;
                setCloudItem('tasks_today', tasksToday);
                renderToday();
                updateBackground();
                if (task.completed) tg.HapticFeedback.impactOccurred('medium'); // вибрация
            }
        });
    });
}

// Модалка добавления задачи
function showAddTaskModal() {
    modalBody.innerHTML = `
        <h3>Новая задача</h3>
        <div class="form-group">
            <label>Название</label>
            <input type="text" id="task-name" placeholder="Например: Помыть посуду">
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

// Добавление задачи
window.addTask = function() {
    let name = document.getElementById('task-name').value;
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

// Модалка добавления привычки
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

window.saveHabit = function(index) {
    let name = document.getElementById('habit-name').value;
    let weight = parseInt(document.getElementById('habit-weight').value) || 1;
    let time = document.getElementById('habit-time').value;
    let type = document.getElementById('schedule-type').value;
    let days = [];
    if (type === 'weekly') {
        let input = document.getElementById('weekly-days-input').value;
        days = input.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n >=0 && n <=6);
    }
    
    let habit = {
        id: index !== null && habits[index] ? habits[index].id : Date.now(),
        name,
        weight,
        timeOfDay: time,
        schedule: { type, days }
    };
    
    if (index !== null) {
        habits[index] = habit;
    } else {
        habits.push(habit);
    }
    
    setCloudItem('habits', habits);
    modal.style.display = 'none';
    renderHabits();
};

window.deleteHabit = function(index) {
    if (confirm('Удалить привычку?')) {
        habits.splice(index, 1);
        setCloudItem('habits', habits);
        renderHabits();
    }
};

window.editHabit = function(index) {
    showAddHabitModal(index);
};

// ==================== ВКЛАДКА ТАЙМЕРЫ ====================
function renderTimers() {
    let html = '<div class="timers-list">';
    timers.forEach((timer, idx) => {
        let remaining = timer.remaining !== undefined ? timer.remaining : timer.duration * 60;
        let mins = Math.floor(remaining / 60);
        let secs = remaining % 60;
        html += `
            <div class="timer-item" data-idx="${idx}">
                <div class="timer-header">
                    <span class="timer-name">${timer.name}</span>
                    <span class="timer-time">${mins}:${secs < 10 ? '0' : ''}${secs}</span>
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

function showAddTimerModal() {
    modalBody.innerHTML = `
        <h3>Новый таймер</h3>
        <div class="form-group">
            <label>Название</label>
            <input type="text" id="timer-name">
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
    let name = document.getElementById('timer-name').value;
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
                tg.HapticFeedback.notificationOccurred('success'); // вибрация
                // Можно показать уведомление
            }
            renderTimers(); // обновляем каждую секунду
        }, 1000);
    }
    saveTimersToLocal();
    renderTimers();
}

function stopTimer(idx) {
    let timer = timers[idx];
    if (timer.interval) {
        clearInterval(timer.interval);
        timer.interval = null;
    }
    timer.remaining = timer.duration * 60;
    saveTimersToLocal();
    renderTimers();
}

function deleteTimer(idx) {
    if (timers[idx].interval) clearInterval(timers[idx].interval);
    timers.splice(idx, 1);
    saveTimersToLocal();
    renderTimers();
}

function saveTimersToLocal() {
    localStorage.setItem('timers', JSON.stringify(timers));
}

// Загружаем таймеры при старте
let savedTimers = localStorage.getItem('timers');
if (savedTimers) {
    timers = JSON.parse(savedTimers);
    // Восстанавливаем оставшееся время (оно могло устареть)
    timers.forEach(t => {
        if (t.remaining === undefined) t.remaining = t.duration * 60;
    });
}

// ==================== ВКЛАДКА АРХИВ ====================
function renderArchive() {
    let now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth();
    
    let firstDay = new Date(year, month, 1);
    let startDay = firstDay.getDay(); // день недели первого числа (0 вс)
    let daysInMonth = new Date(year, month + 1, 0).getDate();
    
    let html = `
        <div class="calendar-header">
            <button onclick="changeMonth(-1)">◀</button>
            <span class="calendar-month">${now.toLocaleString('ru', { month: 'long', year: 'numeric' })}</span>
            <button onclick="changeMonth(1)">▶</button>
        </div>
        <div class="calendar-grid">
    `;
    
    // Пустые ячейки до первого дня
    for (let i = 0; i < startDay; i++) {
        html += `<div class="calendar-day" style="background: #111;"></div>`;
    }
    
    for (let d = 1; d <= daysInMonth; d++) {
        let dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        let percent = history[dateStr] || 0;
        let brightness = Math.min(255, Math.floor(255 * percent / 100));
        let color = `rgb(${brightness}, ${brightness}, ${brightness})`;
        html += `<div class="calendar-day" style="background: ${color}; color: ${brightness > 128 ? '#000' : '#fff'};" onclick="showDayDetails('${dateStr}')">${d}</div>`;
    }
    
    html += '</div>';
    contentDiv.innerHTML = html;
}

window.changeMonth = function(delta) {
    // Для упрощения просто перезагрузим страницу с новым месяцем? В реальном приложении нужно хранить текущий месяц.
    // Пока можно просто показать сообщение, что функциональность в разработке.
    alert('Переключение месяца будет добавлено позже');
};

window.showDayDetails = function(dateStr) {
    let percent = history[dateStr] || 0;
    alert(`Дата: ${dateStr}\nПрогресс: ${percent}%`);
};

// ==================== ОБНОВЛЕНИЕ ФОНА ====================
function updateBackground() {
    let total = tasksToday.reduce((sum, t) => sum + (t.completed ? t.weight : 0), 0);
    let brightness = Math.min(255, Math.floor(255 * total / 100));
    let bgColor = `rgb(${brightness}, ${brightness}, ${brightness})`;
    document.body.style.backgroundColor = bgColor;
    
    // Цвет текста
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
    if (total > 100) {
        document.querySelector('.app').classList.add('divine-glow');
    } else {
        document.querySelector('.app')?.classList.remove('divine-glow');
    }
}

// Закрытие модалки
window.closeModal = function() {
    modal.style.display = 'none';
};