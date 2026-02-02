// ==================== INITIALIZATION ====================
// Load Google Charts ONCE with a callback
google.charts.load('current', {
    packages: ['corechart'],
    callback: function() {
        console.log('Google Charts loaded successfully');
        SimulationState.googleChartsLoaded = true;
        
        // If we have data waiting to be charted, draw now
        if (SimulationState.pendingChartData) {
            generateGraphs(SimulationState.pendingChartData);
            SimulationState.pendingChartData = null;
        }
    }
});

// Global state
const SimulationState = {
    currentModel: null,
    simulationData: null,
    charts: {},
    isAnimating: false,
    isDarkMode: localStorage.getItem('theme') === 'dark',
    googleChartsLoaded: false,
    pendingChartData: null
};

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    initializeTheme();
    initializeEventListeners();
    initializeModelSelection();
    initializeInputValidation();
    setDefaultValues();
    initTooltips();
});

// ==================== THEME MANAGEMENT ====================
function initializeTheme() {
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        const currentTheme = SimulationState.isDarkMode ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', currentTheme);
        themeToggle.checked = SimulationState.isDarkMode;
        themeToggle.addEventListener('change', toggleTheme);
    }
}

function toggleTheme() {
    SimulationState.isDarkMode = !SimulationState.isDarkMode;
    const newTheme = SimulationState.isDarkMode ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    showToast(`Switched to ${newTheme === 'dark' ? 'Dark' : 'Light'} Mode`, 'info', 2000);

    if (SimulationState.simulationData) {
        setTimeout(redrawAllCharts, 300);
    }
}

// ==================== EVENT LISTENERS ====================
function initializeEventListeners() {
    document.querySelectorAll('.model-option').forEach(option => {
        option.addEventListener('click', function() {
            const model = this.getAttribute('data-model');
            selectModel(model);
        });
    });

    const calculateBtn = document.getElementById('calculate-btn');
    if (calculateBtn) {
        calculateBtn.addEventListener('click', runSimulation);
    }

    const resetBtn = document.getElementById('reset-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetSimulation);
    }

    const helpBtn = document.getElementById('help-btn');
    if (helpBtn) {
        helpBtn.addEventListener('click', showHelp);
    }

    const exportBtn = document.getElementById('export-charts');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportCharts);
    }

    const toggleAnimBtn = document.getElementById('toggle-animation');
    if (toggleAnimBtn) {
        toggleAnimBtn.addEventListener('click', toggleChartAnimation);
    }

    const arrivalInput = document.getElementById('mean-arrival');
    const serviceInput = document.getElementById('service-mean');
    if (arrivalInput) arrivalInput.addEventListener('input', validateUtilization);
    if (serviceInput) serviceInput.addEventListener('input', validateUtilization);

    const exportLink = document.querySelector('.export-data-link');
    if (exportLink) {
        exportLink.addEventListener('click', function(e) {
            e.preventDefault();
            exportSimulationData();
        });
    }

    const helpLink = document.getElementById('help-link');
    if (helpLink) {
        helpLink.addEventListener('click', function(e) {
            e.preventDefault();
            showHelp();
        });
    }
}

// ==================== MODEL SELECTION ====================
function initializeModelSelection() {
    selectModel('M/M/1');
}

function selectModel(model) {
    document.querySelectorAll('.model-option').forEach(opt => {
        opt.classList.remove('active');
    });
    
    const selectedOption = document.querySelector(`.model-option[data-model="${model}"]`);
    if (selectedOption) {
        selectedOption.classList.add('active');
        SimulationState.currentModel = model;
        
        const displayElement = document.getElementById('selected-model-display');
        if (displayElement) {
            displayElement.innerHTML = `
                <div class="selected-model-header">
                    <i class="fas fa-check-circle me-2"></i>Selected Model:
                </div>
                <div class="badge bg-primary">${model}</div>
            `;
        }
        
        validateUtilization();
        showModelInfo(model);
    }
}

function showModelInfo(model) {
    const modelInfo = {
        'M/M/1': 'Single server queue with Poisson arrivals and exponential service times.',
        'M/M/2': 'Two identical servers with Poisson arrivals and exponential service times.',
        'M/M/3': 'Three identical servers with Poisson arrivals and exponential service times.',
        'M/M/4': 'Four identical servers with Poisson arrivals and exponential service times.'
    };
    showToast(modelInfo[model], 'info', 3000);
}

// ==================== SIMULATION FUNCTIONS ====================
function runSimulation() {
    if (!validateInputs()) return;
    showLoading(true);

    const arrivalMean = parseFloat(document.getElementById('mean-arrival').value);
    const serviceMean = parseFloat(document.getElementById('service-mean').value);
    const simulationTime = parseInt(document.getElementById('simulation-time').value);
    const model = SimulationState.currentModel;

    if (!model) {
        showToast('Please select a queueing model', 'error', 3000);
        showLoading(false);
        return;
    }

    const c = parseInt(model.split('/')[2]);
    const lambda = 1 / arrivalMean;
    const mu = 1 / serviceMean;
    const utilization = lambda / (c * mu);

    if (utilization >= 1) {
        showToast(`System is unstable: Utilization (ρ = ${utilization.toFixed(2)}) ≥ 1`, 'error', 5000);
        showLoading(false);
        return;
    }

    setTimeout(() => {
        try {
            let simulationResult, theoreticalParams;
            
            const interarrivals = generateInterarrivals(arrivalMean, simulationTime);
            const serviceTimes = interarrivals.map(() => roundTo(exponentialRandom(serviceMean), 2));
            
            simulationResult = simulateQueue(interarrivals, serviceTimes, c);
            
            if (c === 1) {
                theoreticalParams = calculateMM1Params(lambda, mu);
            } else {
                theoreticalParams = calculateMultiServerParams(lambda, mu, c);
            }
            
            updateSimulationTables(simulationResult, c);
            updateCPTable(arrivalMean);
            updateKPIs(theoreticalParams, simulationResult);
            updateStats(simulationResult);
            updateServerStats(simulationResult, c);
            
            SimulationState.simulationData = {
                arrival: simulationResult.arrivalTimes,
                service: simulationResult.serviceTimes,
                turnAround: simulationResult.turnaroundTimes,
                queueLength: simulationResult.queueLengths
            };
            
            // Draw charts - will wait if library not loaded
            generateGraphs(SimulationState.simulationData);
            
            showLoading(false);
            showToast('Simulation completed successfully!', 'success', 3000);
            
            document.querySelector('.stats-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            
        } catch (error) {
            console.error('Simulation error:', error);
            showToast('Error running simulation: ' + error.message, 'error', 5000);
            showLoading(false);
        }
    }, 800);
}

function showLoading(show) {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.style.display = show ? 'flex' : 'none';
    }
}

// ==================== INPUT VALIDATION ====================
function initializeInputValidation() {
    const inputs = document.querySelectorAll('input[type="number"]');
    inputs.forEach(input => {
        input.addEventListener('input', function() {
            if (this.value < 0) this.value = Math.abs(this.value);
        });
    });
}

function validateInputs() {
    const model = SimulationState.currentModel;
    const arrivalMean = document.getElementById('mean-arrival');
    const serviceMean = document.getElementById('service-mean');
    const simulationTime = document.getElementById('simulation-time');
    
    if (!model || model === 'None Selected') {
        showToast('Please select a queueing model', 'warning', 3000);
        return false;
    }

    if (!simulationTime || !simulationTime.value || simulationTime.value <= 0) {
        showToast('Please enter a valid simulation time', 'warning', 3000);
        if (simulationTime) simulationTime.focus();
        return false;
    }

    if (!arrivalMean || !arrivalMean.value || arrivalMean.value <= 0) {
        showToast('Please enter a valid arrival rate', 'warning', 3000);
        if (arrivalMean) arrivalMean.focus();
        return false;
    }

    if (!serviceMean || !serviceMean.value || serviceMean.value <= 0) {
        showToast('Please enter a valid service rate', 'warning', 3000);
        if (serviceMean) serviceMean.focus();
        return false;
    }

    return true;
}

function validateUtilization() {
    const arrivalMeanInput = document.getElementById('mean-arrival');
    const serviceMeanInput = document.getElementById('service-mean');
    const model = SimulationState.currentModel;
    
    if (!arrivalMeanInput || !serviceMeanInput || !model) return;

    const arrivalMean = parseFloat(arrivalMeanInput.value);
    const serviceMean = parseFloat(serviceMeanInput.value);

    if (!arrivalMean || !serviceMean) return;

    const c = parseInt(model.split('/')[2]);
    const lambda = 1 / arrivalMean;
    const mu = 1 / serviceMean;
    const utilization = lambda / (c * mu);

    const warningElement = document.getElementById('utilization-warning');
    const warningText = document.getElementById('warning-text');

    if (warningElement && warningText) {
        if (utilization >= 0.9) {
            warningElement.style.display = 'block';
            warningText.innerHTML = `<i class="fas fa-exclamation-triangle me-2"></i>High utilization detected (ρ = ${utilization.toFixed(2)}). System may experience long queues.`;
            warningElement.className = 'alert alert-warning';
        } else if (utilization >= 0.7) {
            warningElement.style.display = 'block';
            warningText.innerHTML = `<i class="fas fa-info-circle me-2"></i>Moderate utilization (ρ = ${utilization.toFixed(2)}). System operating efficiently.`;
            warningElement.className = 'alert alert-info';
        } else if (utilization < 0.3) {
            warningElement.style.display = 'block';
            warningText.innerHTML = `<i class="fas fa-info-circle me-2"></i>Low utilization (ρ = ${utilization.toFixed(2)}). System may be over-provisioned.`;
            warningElement.className = 'alert alert-secondary';
        } else {
            warningElement.style.display = 'none';
        }
    }

    const utilizationElement = document.getElementById('stat-utilization');
    if (utilizationElement) {
        utilizationElement.textContent = `${Math.min(99, Math.round(utilization * 100))}%`;
    }
}

// ==================== UTILITY FUNCTIONS ====================
function factorial(n) {
    if (n < 0) return null;
    if (n === 0 || n === 1) return 1;
    let result = 1;
    for (let i = 2; i <= n; i++) {
        result *= i;
    }
    return result;
}

function exponentialRandom(mean) {
    return -Math.log(1 - Math.random()) * mean;
}

function roundTo(value, decimals = 2) {
    return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

function cpCalc(arrivalMean) {
    let cp = 0;
    let count = 0;
    const cparray = [];
    const cplookuparray = [];
    
    while (cp < 0.9999 && count < 200) {
        const calc = Math.exp(-arrivalMean) * Math.pow(arrivalMean, count) / factorial(count);
        const prevCp = cp;
        cp += calc;
        
        cplookuparray.push(prevCp);
        cparray.push(Math.min(cp, 1));
        count++;
    }
    
    return [cparray, cplookuparray];
}

// ==================== QUEUE SIMULATION ====================
function generateInterarrivals(mean, maxTime) {
    const interarrivals = [0];
    let totalTime = 0;
    
    try {
        const [cparray, cplookuparray] = cpCalc(mean);
        
        while (totalTime < maxTime) {
            const random = Math.random();
            let interarrival = 1;
            
            for (let j = 0; j < cplookuparray.length; j++) {
                if (random >= cplookuparray[j] && random < cparray[j]) {
                    interarrival = j + 1;
                    break;
                }
            }
            
            interarrivals.push(interarrival);
            totalTime += interarrival;
        }
        
        if (totalTime > maxTime) interarrivals.pop();
        
        return interarrivals;
    } catch (error) {
        console.error('CP calculation failed, using exponential distribution:', error);
        while (totalTime < maxTime) {
            const interarrival = Math.max(1, Math.round(exponentialRandom(mean)));
            interarrivals.push(interarrival);
            totalTime += interarrival;
        }
        if (totalTime > maxTime) interarrivals.pop();
        return interarrivals;
    }
}

function simulateQueue(interarrivals, serviceTimes, serverCount) {
    const arrivalTimes = [0];
    let currentTime = 0;
    
    for (let i = 1; i < interarrivals.length; i++) {
        currentTime += interarrivals[i];
        arrivalTimes.push(roundTo(currentTime, 2));
    }
    
    const serverEndTimes = new Array(serverCount).fill(0);
    const queueLengths = [];
    
    const startTimes = [];
    const endTimes = [];
    const waitTimes = [];
    const turnaroundTimes = [];
    const responseTimes = [];
    const servers = [];
    
    for (let i = 0; i < arrivalTimes.length; i++) {
        const arrival = arrivalTimes[i];
        const service = serviceTimes[i];
        
        let serverIndex = 0;
        let earliestEndTime = serverEndTimes[0];
        
        for (let s = 1; s < serverCount; s++) {
            if (serverEndTimes[s] < earliestEndTime) {
                earliestEndTime = serverEndTimes[s];
                serverIndex = s;
            }
        }
        
        const startTime = Math.max(arrival, serverEndTimes[serverIndex]);
        const endTime = startTime + service;
        const waitTime = Math.max(0, startTime - arrival);
        const turnaroundTime = endTime - arrival;
        
        let queuedCustomers = 0;
        for (let s = 0; s < serverCount; s++) {
            if (serverEndTimes[s] > arrival) queuedCustomers++;
        }
        const currentQueueLength = Math.max(0, queuedCustomers - serverCount);
        queueLengths.push(currentQueueLength);
        
        startTimes.push(roundTo(startTime, 2));
        endTimes.push(roundTo(endTime, 2));
        waitTimes.push(roundTo(waitTime, 2));
        turnaroundTimes.push(roundTo(turnaroundTime, 2));
        responseTimes.push(roundTo(waitTime + service, 2));
        servers.push(serverIndex + 1);
        
        serverEndTimes[serverIndex] = endTime;
    }
    
    return {
        interarrivals,
        arrivalTimes,
        serviceTimes,
        startTimes,
        endTimes,
        waitTimes,
        turnaroundTimes,
        responseTimes,
        servers,
        queueLengths,
        totalCustomers: arrivalTimes.length,
        totalTime: Math.max(...endTimes)
    };
}

// ==================== CHART GENERATION ====================
// CRITICAL FIX: Charts are now drawn WITHOUT setOnLoadCallback inside each function
function generateGraphs(data) {
    if (!data) return;
    
    // If Google Charts hasn't loaded yet, store data and wait
    if (!SimulationState.googleChartsLoaded) {
        console.log('Google Charts not loaded yet, storing data for later...');
        SimulationState.pendingChartData = data;
        showToast('Loading chart library...', 'info', 2000);
        return;
    }
    
    // Draw all charts
    drawArrivalChart(data.arrival || []);
    drawServiceTimeChart(data.service || []);
    drawTurnAroundTimeChart(data.turnAround || []);
    drawQueueLengthChart(data.queueLength || []);
}

// FIXED: Removed google.charts.setOnLoadCallback wrapper
function drawArrivalChart(arrivalTimes) {
    const container = document.getElementById('linechart');
    if (!container) return;
    
    try {
        const data = new google.visualization.DataTable();
        data.addColumn('number', 'Customer');
        data.addColumn('number', 'Arrival Time (min)');
        
        arrivalTimes.forEach((time, index) => {
            data.addRow([index + 1, time]);
        });
        
        const options = {
            title: 'Customer Arrival Pattern',
            curveType: 'function',
            legend: { position: 'bottom' },
            height: 400,
            backgroundColor: 'transparent',
            hAxis: {
                title: 'Customer Number',
                textStyle: { color: getCSSVar('--chart-text'), fontSize: 12, bold: true },
                titleTextStyle: { color: getCSSVar('--chart-text'), fontSize: 14, bold: true },
                gridlines: { color: getCSSVar('--chart-grid') }
            },
            vAxis: {
                title: 'Time (minutes)',
                textStyle: { color: getCSSVar('--chart-text'), fontSize: 12, bold: true },
                titleTextStyle: { color: getCSSVar('--chart-text'), fontSize: 14, bold: true },
                gridlines: { color: getCSSVar('--chart-grid') },
                minValue: 0
            },
            colors: [getCSSVar('--chart-arrival')],
            animation: {
                duration: SimulationState.isAnimating ? 1000 : 0,
                easing: 'out',
                startup: true
            },
            chartArea: { left: 60, top: 50, width: '85%', height: '70%' },
            pointSize: 5,
            lineWidth: 2.5,
            tooltip: { isHtml: true },
            explorer: { actions: ['dragToZoom', 'rightClickToReset'], maxZoomIn: 0.1 }
        };
        
        const chart = new google.visualization.LineChart(container);
        chart.draw(data, options);
        SimulationState.charts.arrival = chart;
    } catch (error) {
        console.error('Error drawing arrival chart:', error);
        container.innerHTML = '<div class="text-center text-danger py-4">Error loading chart</div>';
    }
}

// FIXED: Removed google.charts.setOnLoadCallback wrapper
function drawServiceTimeChart(serviceTimes) {
    const container = document.getElementById('linechart-service');
    if (!container) return;
    
    try {
        const data = new google.visualization.DataTable();
        data.addColumn('number', 'Customer');
        data.addColumn('number', 'Service Time (min)');
        
        serviceTimes.forEach((time, index) => {
            data.addRow([index + 1, time]);
        });
        
        const options = {
            title: 'Service Time Distribution',
            legend: { position: 'bottom' },
            height: 400,
            backgroundColor: 'transparent',
            hAxis: {
                title: 'Customer Number',
                textStyle: { color: getCSSVar('--chart-text'), fontSize: 12, bold: true },
                titleTextStyle: { color: getCSSVar('--chart-text'), fontSize: 14, bold: true },
                gridlines: { color: getCSSVar('--chart-grid') }
            },
            vAxis: {
                title: 'Time (minutes)',
                textStyle: { color: getCSSVar('--chart-text'), fontSize: 12, bold: true },
                titleTextStyle: { color: getCSSVar('--chart-text'), fontSize: 14, bold: true },
                gridlines: { color: getCSSVar('--chart-grid') },
                minValue: 0
            },
            colors: [getCSSVar('--chart-service')],
            animation: {
                duration: SimulationState.isAnimating ? 1000 : 0,
                easing: 'out',
                startup: true
            },
            chartArea: { left: 60, top: 50, width: '85%', height: '70%' },
            bar: { groupWidth: '70%' },
            tooltip: { isHtml: true }
        };
        
        const chart = new google.visualization.ColumnChart(container);
        chart.draw(data, options);
        SimulationState.charts.service = chart;
    } catch (error) {
        console.error('Error drawing service chart:', error);
        container.innerHTML = '<div class="text-center text-danger py-4">Error loading chart</div>';
    }
}

// FIXED: Removed google.charts.setOnLoadCallback wrapper
function drawTurnAroundTimeChart(turnAroundTimes) {
    const container = document.getElementById('linechart-turnAround');
    if (!container) return;
    
    try {
        const data = new google.visualization.DataTable();
        data.addColumn('number', 'Customer');
        data.addColumn('number', 'Turnaround Time (min)');
        
        turnAroundTimes.forEach((time, index) => {
            data.addRow([index + 1, time]);
        });
        
        const options = {
            title: 'Turnaround Time Analysis',
            height: 400,
            backgroundColor: 'transparent',
            hAxis: {
                title: 'Customer Number',
                textStyle: { color: getCSSVar('--chart-text'), fontSize: 12, bold: true },
                titleTextStyle: { color: getCSSVar('--chart-text'), fontSize: 14, bold: true },
                gridlines: { color: getCSSVar('--chart-grid') }
            },
            vAxis: {
                title: 'Time (minutes)',
                textStyle: { color: getCSSVar('--chart-text'), fontSize: 12, bold: true },
                titleTextStyle: { color: getCSSVar('--chart-text'), fontSize: 14, bold: true },
                gridlines: { color: getCSSVar('--chart-grid') },
                minValue: 0
            },
            colors: [getCSSVar('--chart-turnaround')],
            animation: {
                duration: SimulationState.isAnimating ? 1000 : 0,
                easing: 'out',
                startup: true
            },
            chartArea: { left: 60, top: 50, width: '85%', height: '70%' },
            curveType: 'function',
            pointSize: 5,
            lineWidth: 2.5,
            tooltip: { isHtml: true },
            explorer: { actions: ['dragToZoom', 'rightClickToReset'], maxZoomIn: 0.1 }
        };
        
        const chart = new google.visualization.LineChart(container);
        chart.draw(data, options);
        SimulationState.charts.turnaround = chart;
    } catch (error) {
        console.error('Error drawing turnaround chart:', error);
        container.innerHTML = '<div class="text-center text-danger py-4">Error loading chart</div>';
    }
}

// FIXED: Removed google.charts.setOnLoadCallback wrapper and syntax errors
function drawQueueLengthChart(queueLengths) {
    const container = document.getElementById('queue-length-chart');
    if (!container) return;
    
    try {
        const data = new google.visualization.DataTable();
        data.addColumn('number', 'Time (min)');
        data.addColumn('number', 'Queue Length');
        
        queueLengths.forEach((length, index) => {
            if (index < queueLengths.length - 1) {
                data.addRow([index, length]);
            }
        });
        
        const options = {
            title: 'Queue Length Dynamics',
            height: 400,
            backgroundColor: 'transparent',
            hAxis: {
                title: 'Simulation Time (minutes)',
                textStyle: { color: getCSSVar('--chart-text'), fontSize: 12, bold: true },
                titleTextStyle: { color: getCSSVar('--chart-text'), fontSize: 14, bold: true },
                gridlines: { color: getCSSVar('--chart-grid') }
            },
            vAxis: {
                title: 'Customers Waiting',
                minValue: 0,
                textStyle: { color: getCSSVar('--chart-text'), fontSize: 12, bold: true },
                titleTextStyle: { color: getCSSVar('--chart-text'), fontSize: 14, bold: true },
                gridlines: { color: getCSSVar('--chart-grid') }
            },
            colors: [getCSSVar('--chart-queue')],
            animation: {
                duration: SimulationState.isAnimating ? 1000 : 0,
                easing: 'out',
                startup: true
            },
            chartArea: { left: 60, top: 50, width: '85%', height: '70%' },
            areaOpacity: 0.35,
            lineWidth: 3,
            pointSize: 4,
            tooltip: { isHtml: true },
            explorer: { actions: ['dragToZoom', 'rightClickToReset'], maxZoomIn: 0.1 }
        };
        
        const chart = new google.visualization.AreaChart(container);
        chart.draw(data, options);
        SimulationState.charts.queue = chart;
    } catch (error) {
        console.error('Error drawing queue chart:', error);
        container.innerHTML = '<div class="text-center text-danger py-4">Error loading chart</div>';
    }
}

function getCSSVar(variable) {
    return getComputedStyle(document.documentElement).getPropertyValue(variable) || '#6c757d';
}

// ==================== TABLE UPDATES ====================
function updateSimulationTables(simulation, serverCount) {
    const tbody = document.getElementById('simulation_table');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    const maxRows = Math.min(simulation.totalCustomers, 200);
    
    for (let i = 0; i < maxRows; i++) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${i + 1}</td>
            <td>${simulation.interarrivals[i].toFixed(2)}</td>
            <td>${simulation.arrivalTimes[i].toFixed(2)}</td>
            <td>${simulation.serviceTimes[i].toFixed(2)}</td>
            <td>${simulation.startTimes[i].toFixed(2)}</td>
            <td>${simulation.endTimes[i].toFixed(2)}</td>
            <td>${simulation.turnaroundTimes[i].toFixed(2)}</td>
            <td>${simulation.waitTimes[i].toFixed(2)}</td>
            <td>${simulation.responseTimes[i].toFixed(2)}</td>
            <td><span class="badge bg-primary px-2 py-1">Server ${simulation.servers[i]}</span></td>
        `;
        tbody.appendChild(row);
    }
    
    if (simulation.totalCustomers > 200) {
        const noticeRow = document.createElement('tr');
        noticeRow.innerHTML = `
            <td colspan="10" class="text-center text-muted fst-italic py-3">
                Showing first 200 of ${simulation.totalCustomers} customers. 
                <span class="badge bg-secondary ms-2">Performance Optimized</span>
            </td>
        `;
        tbody.appendChild(noticeRow);
    }
}

function updateCPTable(arrivalMean) {
    const tbody = document.getElementById('cp_table');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    try {
        const [cparray, cplookuparray] = cpCalc(arrivalMean);
        const maxEntries = Math.min(15, cparray.length);
        
        for (let i = 0; i < maxEntries; i++) {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${cplookuparray[i].toFixed(4)}</td>
                <td>${cparray[i].toFixed(4)}</td>
                <td>${i} minute(s)</td>
            `;
            tbody.appendChild(row);
        }
        
        if (cparray.length > maxEntries) {
            const noticeRow = document.createElement('tr');
            noticeRow.innerHTML = `
                <td colspan="3" class="text-center text-muted fst-italic py-2">
                    Showing first ${maxEntries} entries of ${cparray.length} total probability values
                </td>
            `;
            tbody.appendChild(noticeRow);
        }
    } catch (error) {
        console.error('CP table generation failed:', error);
        tbody.innerHTML = `
            <tr>
                <td colspan="3" class="text-center text-danger py-4">
                    <i class="fas fa-exclamation-triangle fa-2x mb-2"></i>
                    <p>Error generating probability table</p>
                </td>
            </tr>
        `;
    }
}

// ==================== KPI & STATS UPDATES ====================
function updateKPIs(theoretical, simulation) {
    document.getElementById('kpi-lq').textContent = theoretical.lq.toFixed(2);
    document.getElementById('kpi-wq').textContent = theoretical.wq.toFixed(2);
    document.getElementById('kpi-ws').textContent = theoretical.ws.toFixed(2);
    document.getElementById('kpi-ls').textContent = theoretical.ls.toFixed(2);
}

function updateStats(simulation) {
    const totalCustomers = simulation.totalCustomers;
    const avgWait = simulation.waitTimes.reduce((a, b) => a + b, 0) / totalCustomers;
    const avgTurnaround = simulation.turnaroundTimes.reduce((a, b) => a + b, 0) / totalCustomers;
    
    document.getElementById('stat-arrivals').textContent = totalCustomers;
    document.getElementById('stat-wait').textContent = avgWait.toFixed(2);
    document.getElementById('stat-turnaround').textContent = avgTurnaround.toFixed(2);
}

function updateServerStats(simulation, serverCount) {
    const container = document.getElementById('server-stats-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    const serverStats = Array(serverCount).fill().map(() => ({ 
        customers: 0, 
        busyTime: 0,
        totalServiceTime: 0
    }));
    
    for (let i = 0; i < simulation.servers.length; i++) {
        const serverIndex = simulation.servers[i] - 1;
        if (serverIndex >= 0 && serverIndex < serverCount) {
            serverStats[serverIndex].customers++;
            serverStats[serverIndex].totalServiceTime += simulation.serviceTimes[i];
        }
    }
    
    const totalTime = simulation.totalTime || 1;
    
    for (let i = 0; i < serverCount; i++) {
        const utilization = (serverStats[i].totalServiceTime / totalTime) * 100;
        const avgServiceTime = serverStats[i].customers > 0 
            ? (serverStats[i].totalServiceTime / serverStats[i].customers) 
            : 0;
        
        const col = document.createElement('div');
        col.className = `col-md-${Math.floor(12 / serverCount)} mb-4`;
        col.innerHTML = `
            <div class="server-stat-card card h-100 border-top border-4 border-primary shadow-sm">
                <div class="card-body text-center p-4">
                    <div class="mb-3">
                        <div class="bg-primary bg-opacity-10 d-inline-flex align-items-center justify-content-center rounded-circle" style="width: 60px; height: 60px;">
                            <i class="fas fa-server fa-2x text-primary"></i>
                        </div>
                    </div>
                    <h5 class="mb-1">Server ${i + 1}</h5>
                    <div class="stat-value fs-2 fw-bold mb-2">${serverStats[i].customers}</div>
                    <div class="stat-label mb-3">Customers Served</div>
                    <div class="d-flex justify-content-around text-center">
                        <div>
                            <div class="fw-bold text-primary">${utilization.toFixed(1)}%</div>
                            <small class="text-muted">Utilization</small>
                        </div>
                        <div>
                            <div class="fw-bold text-success">${avgServiceTime.toFixed(1)} min</div>
                            <small class="text-muted">Avg Service</small>
                        </div>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(col);
    }
}

// ==================== QUEUE THEORY CALCULATIONS ====================
function calculateMM1Params(lambda, mu) {
    const rho = lambda / mu;
    const lq = (rho ** 2) / (1 - rho);
    const wq = lq / lambda;
    const ws = wq + (1 / mu);
    const ls = lambda * ws;
    return { rho, lq, wq, ws, ls };
}

function calculateMultiServerParams(lambda, mu, c) {
    let sum = 0;
    for (let n = 0; n < c; n++) {
        sum += (lambda / mu) ** n / factorial(n);
    }
    const rho = lambda / (c * mu);
    const p0 = 1 / (sum + ((lambda / mu) ** c) / (factorial(c) * (1 - rho)));
    const lq = (p0 * ((lambda / mu) ** c) * rho) / (factorial(c) * ((1 - rho) ** 2));
    const wq = lq / lambda;
    const ws = wq + (1 / mu);
    const ls = lambda * ws;
    return { rho, p0, lq, wq, ws, ls };
}

// ==================== UI HELPERS ====================
function resetSimulation() {
    if (!confirm('Reset simulation? All current results will be lost.')) return;
    
    document.getElementById('simulation-time').value = '480';
    document.getElementById('mean-arrival').value = '5';
    document.getElementById('service-mean').value = '6';
    
    document.getElementById('simulation_table').innerHTML = `
        <tr>
            <td colspan="10" class="text-center py-5 text-muted">
                <i class="fas fa-play-circle fa-3x mb-3 opacity-50"></i>
                <p class="fs-5 fw-bold mb-1">Ready to Simulate</p>
                <p class="mb-0">Configure parameters and click "Run Simulation" to generate data</p>
            </td>
        </tr>
    `;
    
    document.getElementById('cp_table').innerHTML = `
        <tr>
            <td colspan="3" class="text-center py-5 text-muted">
                <i class="fas fa-chart-line fa-3x mb-3 opacity-50"></i>
                <p class="fs-5 fw-bold mb-1">Cumulative Probability Table</p>
                <p class="mb-0">Run simulation to generate probability distribution data</p>
            </td>
        </tr>
    `;
    
    ['stat-arrivals', 'stat-utilization', 'stat-wait', 'stat-turnaround', 
     'kpi-lq', 'kpi-wq', 'kpi-ws', 'kpi-ls'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = id.includes('utilization') ? '0%' : '0.00';
    });
    
    document.getElementById('server-stats-container').innerHTML = `
        <div class="col-12 text-center py-5">
            <i class="fas fa-server fa-3x text-muted mb-3"></i>
            <p class="text-muted fs-5">Run simulation to view server statistics</p>
            <p class="text-muted">Select a model and click "Run Simulation" to generate performance metrics</p>
        </div>
    `;
    
    ['linechart', 'linechart-service', 'linechart-turnAround', 'queue-length-chart'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<div class="text-center py-5 text-muted">Chart will appear after simulation</div>';
    });
    
    SimulationState.simulationData = null;
    SimulationState.charts = {};
    SimulationState.pendingChartData = null;
    
    selectModel('M/M/1');
    validateUtilization();
    
    showToast('Simulation reset successfully', 'info', 2500);
}

function showToast(message, type = 'info', duration = 3000) {
    const gradientMap = {
        success: 'linear-gradient(135deg, #06d6a0, #118ab2)',
        error: 'linear-gradient(135deg, #ef476f, #d62839)',
        warning: 'linear-gradient(135deg, #ffd166, #ff9e64)',
        info: 'linear-gradient(135deg, #4361ee, #3a0ca3)'
    };
    
    Toastify({
        text: message,
        duration: duration,
        gravity: "top",
        position: "right",
        style: {
            background: gradientMap[type] || gradientMap.info,
            borderRadius: '16px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
            padding: '18px 28px',
            fontSize: '16px',
            fontWeight: '600',
            color: 'white',
            maxWidth: '400px'
        },
        stopOnFocus: true
    }).showToast();
}

function showHelp() {
    const modal = new bootstrap.Modal(document.getElementById('helpModal'));
    modal.show();
}

function setDefaultValues() {
    document.getElementById('simulation-time').value = '480';
    document.getElementById('mean-arrival').value = '5';
    document.getElementById('service-mean').value = '6';
    validateUtilization();
}

// ==================== ADDITIONAL FUNCTIONS ====================
function toggleChartAnimation() {
    SimulationState.isAnimating = !SimulationState.isAnimating;
    const btn = document.getElementById('toggle-animation');
    if (btn) {
        btn.innerHTML = SimulationState.isAnimating ?
            '<i class="fas fa-pause me-1"></i> Pause Animation' :
            '<i class="fas fa-play me-1"></i> Animate Charts';
    }
    if (SimulationState.simulationData) redrawAllCharts();
}

function redrawAllCharts() {
    if (SimulationState.simulationData && SimulationState.googleChartsLoaded) {
        generateGraphs(SimulationState.simulationData);
    }
}

function exportCharts() {
    showToast('Chart export feature coming soon!', 'info', 3000);
}

function exportSimulationData() {
    if (!SimulationState.simulationData) {
        showToast('No simulation data to export. Run a simulation first.', 'warning', 3000);
        return;
    }
    
    const data = {
        model: SimulationState.currentModel,
        parameters: {
            simulationTime: document.getElementById('simulation-time').value,
            arrivalMean: document.getElementById('mean-arrival').value,
            serviceMean: document.getElementById('service-mean').value
        },
        timestamp: new Date().toISOString(),
        stats: {
            totalCustomers: document.getElementById('stat-arrivals').textContent,
            utilization: document.getElementById('stat-utilization').textContent,
            avgWait: document.getElementById('stat-wait').textContent,
            avgTurnaround: document.getElementById('stat-turnaround').textContent
        }
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `carrefour_simulation_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast('Simulation data exported successfully!', 'success', 3000);
}

// ==================== EVENT LISTENERS & INIT ====================
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        runSimulation();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        e.preventDefault();
        resetSimulation();
    }
});

function initTooltips() {
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });
}

// Handle chart tab switching
document.addEventListener('DOMContentLoaded', function() {
    const chartTabs = document.querySelectorAll('#chartTabs button[data-bs-toggle="tab"]');
    chartTabs.forEach(tab => {
        tab.addEventListener('shown.bs.tab', function (e) {
            const target = e.target.getAttribute('data-bs-target');
            if (SimulationState.simulationData && SimulationState.googleChartsLoaded) {
                switch(target) {
                    case '#arrival-chart':
                        drawArrivalChart(SimulationState.simulationData.arrival);
                        break;
                    case '#service-chart':
                        drawServiceTimeChart(SimulationState.simulationData.service);
                        break;
                    case '#turnaround-chart':
                        drawTurnAroundTimeChart(SimulationState.simulationData.turnAround);
                        break;
                    case '#queue-chart':
                        drawQueueLengthChart(SimulationState.simulationData.queueLength);
                        break;
                }
            }
        });
    });
});