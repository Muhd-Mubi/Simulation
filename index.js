// ==================== GLOBAL STATE ====================
const SimulationState = {
    currentModel: 'M/G/1',
    simulationData: null,
    charts: {},
    isAnimating: false,
    isDarkMode: localStorage.getItem('theme') === 'dark',
    googleChartsLoaded: false,
    pendingChartData: null
};

// ==================== INITIALIZATION ====================
google.charts.load('current', { 
    packages: ['corechart'],
    callback: () => {
        SimulationState.googleChartsLoaded = true;
        console.log('Google Charts loaded successfully');
        if (SimulationState.pendingChartData) {
            generateGraphs(SimulationState.pendingChartData);
            SimulationState.pendingChartData = null;
        }
    }
});

document.addEventListener('DOMContentLoaded', () => {
    initializeTheme();
    initializeEventListeners();
    initializeModelSelection();
    initializeInputValidation();
    setDefaultValues();
    
    setTimeout(() => {
        showToast('Welcome to M/G/c Queue Simulator! Configure Gamma parameters and run simulation.', 'info', 4500);
    }, 800);
});

// ==================== THEME MANAGEMENT ====================
function initializeTheme() {
    const themeToggle = document.getElementById('theme-toggle');
    if (!themeToggle) return;
    
    document.documentElement.setAttribute('data-theme', SimulationState.isDarkMode ? 'dark' : 'light');
    themeToggle.checked = SimulationState.isDarkMode;
    
    themeToggle.addEventListener('change', () => {
        SimulationState.isDarkMode = !SimulationState.isDarkMode;
        document.documentElement.setAttribute('data-theme', SimulationState.isDarkMode ? 'dark' : 'light');
        localStorage.setItem('theme', SimulationState.isDarkMode ? 'dark' : 'light');
        
        showToast(`Switched to ${SimulationState.isDarkMode ? 'Dark' : 'Light'} Mode`, 'info', 2500);
        
        if (SimulationState.simulationData && SimulationState.googleChartsLoaded) {
            setTimeout(redrawAllCharts, 300);
        }
    });
}

// ==================== MODEL SELECTION ====================
function initializeModelSelection() {
    document.querySelectorAll('.model-option').forEach(option => {
        option.addEventListener('click', function() {
            document.querySelectorAll('.model-option').forEach(opt => opt.classList.remove('active'));
            this.classList.add('active');
            
            const model = this.getAttribute('data-model');
            SimulationState.currentModel = model;
            
            document.getElementById('selected-model-display').innerHTML = `
                <div class="selected-model-header">
                    <i class="fas fa-check-circle me-2"></i>Selected Model:
                </div>
                <div class="badge bg-primary fs-5 px-3 py-2">${model}</div>
            `;
            
            validateUtilization();
            showToast(`Model changed to ${model} (Poisson arrivals + Gamma service times)`, 'info', 2500);
        });
    });
}

// ==================== INPUT VALIDATION ====================
function initializeInputValidation() {
    ['mean-arrival', 'service-mean-time', 'service-shape-k', 'simulation-time'].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('input', () => {
                if (input.value < 0) input.value = Math.abs(input.value);
                validateUtilization();
            });
        }
    });
}

function validateUtilization() {
    const arrivalMean = parseFloat(document.getElementById('mean-arrival').value);
    const serviceMeanTime = parseFloat(document.getElementById('service-mean-time').value);
    const shapeK = parseFloat(document.getElementById('service-shape-k').value);
    const model = SimulationState.currentModel;
    
    if (!arrivalMean || !serviceMeanTime || !shapeK || !model) return;
    
    const c = parseInt(model.split('/')[2]);
    const lambda = 1 / arrivalMean;  // arrivals per minute
    const mu = 1 / serviceMeanTime;  // services per minute per server
    const utilization = lambda / (c * mu);
    
    const warningEl = document.getElementById('utilization-warning');
    const warningText = document.getElementById('warning-text');
    
    if (utilization >= 1) {
        warningEl.className = 'alert alert-danger';
        warningText.innerHTML = `<i class="fas fa-exclamation-triangle me-2"></i>System unstable! Utilization ρ = ${utilization.toFixed(2)} ≥ 1. Reduce arrival rate or add servers.`;
        warningEl.style.display = 'block';
    } else if (utilization >= 0.85) {
        warningEl.className = 'alert alert-warning';
        warningText.innerHTML = `<i class="fas fa-exclamation-triangle me-2"></i>High utilization (ρ = ${utilization.toFixed(2)}). Expect long queues with variable service times.`;
        warningEl.style.display = 'block';
    } else if (utilization >= 0.6) {
        warningEl.className = 'alert alert-info';
        warningText.innerHTML = `<i class="fas fa-info-circle me-2"></i>Optimal utilization (ρ = ${utilization.toFixed(2)}). System operating efficiently.`;
        warningEl.style.display = 'block';
    } else {
        warningEl.style.display = 'none';
    }
    
    document.getElementById('stat-utilization').textContent = `${Math.min(99, Math.round(utilization * 100))}%`;
    
    // Update chart label with current k value
    document.getElementById('chart-k-value').textContent = shapeK.toFixed(1);
}

// ==================== SIMULATION CORE ====================
function runSimulation() {
    if (!validateInputs()) return;
    
    document.getElementById('loading-overlay').style.display = 'flex';
    
    const arrivalMean = parseFloat(document.getElementById('mean-arrival').value);
    const serviceMeanTime = parseFloat(document.getElementById('service-mean-time').value);
    const shapeK = parseFloat(document.getElementById('service-shape-k').value);
    const simulationTime = parseInt(document.getElementById('simulation-time').value);
    const model = SimulationState.currentModel;
    const c = parseInt(model.split('/')[2]);
    
    const lambda = 1 / arrivalMean;
    const mu = 1 / serviceMeanTime;
    const utilization = lambda / (c * mu);
    
    if (utilization >= 1) {
        showToast('System is unstable! Utilization ≥ 1. Adjust parameters.', 'error', 4000);
        document.getElementById('loading-overlay').style.display = 'none';
        return;
    }
    
    setTimeout(() => {
        try {
            let simulationResult;
            let theoreticalParams;
            
            // Generate interarrival times (Poisson process = exponential inter-arrivals)
            const interarrivals = generateInterarrivals(arrivalMean, simulationTime);
            
            // Generate Gamma-distributed service times
            const serviceTimes = interarrivals.map(() => roundTo(gammaRandom(shapeK, serviceMeanTime), 2));
            
            // Run queue simulation
            simulationResult = simulateQueue(interarrivals, serviceTimes, c);
            
            // Calculate theoretical values based on M/G/c model
            if (c === 1) {
                theoreticalParams = calculateMG1Params(lambda, serviceMeanTime, shapeK);
            } else {
                theoreticalParams = calculateMGCParams(lambda, serviceMeanTime, c, shapeK);
            }
            
            // Update UI with results
            updateSimulationTables(simulationResult, c);
            updateCPTable(arrivalMean);
            updateKPIs(theoreticalParams, simulationResult);
            updateStats(simulationResult);
            updateServerStats(simulationResult, c);
            
            // Store simulation data for charts
            SimulationState.simulationData = {
                arrival: simulationResult.arrivalTimes,
                service: simulationResult.serviceTimes,
                turnAround: simulationResult.turnaroundTimes,
                queueLength: simulationResult.queueLengths,
                shapeK: shapeK
            };
            
            // Draw charts AFTER Google Charts is loaded
            waitForCharts(() => {
                generateGraphs(SimulationState.simulationData);
                document.getElementById('loading-overlay').style.display = 'none';
                showToast('M/G/c Simulation completed successfully!', 'success', 3500);
                
                document.querySelector('.stats-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            });
            
        } catch (error) {
            console.error('Simulation error:', error);
            showToast(`Simulation error: ${error.message}`, 'error', 5000);
            document.getElementById('loading-overlay').style.display = 'none';
        }
    }, 800);
}

function waitForCharts(callback, attempts = 0) {
    if (SimulationState.googleChartsLoaded) {
        callback();
    } else if (attempts < 20) {
        setTimeout(() => waitForCharts(callback, attempts + 1), 100);
    } else {
        console.error('Google Charts failed to load');
        showToast('Chart library failed to load. Results may be incomplete.', 'warning', 4000);
        callback();
    }
}

// ==================== GAMMA RANDOM NUMBER GENERATOR ====================
// Marsaglia and Tsang method for Gamma distribution (shape k, scale theta)
function gammaRandom(shape, scale) {
    // For shape >= 1, use Marsaglia-Tsang method
    if (shape >= 1) {
        const d = shape - 1/3;
        const c = 1 / Math.sqrt(9 * d);
        
        while (true) {
            let x, v;
            do {
                x = normalRandom(0, 1);
                v = 1 + c * x;
            } while (v <= 0);
            
            v = v * v * v;
            const u = Math.random();
            
            if (u < 1 - 0.0331 * x * x * x * x) {
                return d * v * scale;
            }
            
            if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
                return d * v * scale;
            }
        }
    } 
    // For shape < 1, use transformation method
    else {
        const result = gammaRandom(shape + 1, scale);
        const u = Math.random();
        return result * Math.pow(u, 1/shape);
    }
}

// Box-Muller transform for standard normal random variable
function normalRandom(mean = 0, stdDev = 1) {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    
    const z0 = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return z0 * stdDev + mean;
}

// ==================== UTILITY FUNCTIONS ====================
function factorial(n) {
    if (n <= 1) return 1;
    let result = 1;
    for (let i = 2; i <= n; i++) result *= i;
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

// ==================== M/G/c THEORETICAL CALCULATIONS ====================
// M/G/1: Pollaczek-Khinchin formula
function calculateMG1Params(lambda, serviceMeanTime, shapeK) {
    const mu = 1 / serviceMeanTime;
    const rho = lambda / mu;
    const Cs_squared = 1 / shapeK; // Squared coefficient of variation for Gamma
    
    // Pollaczek-Khinchin formula for Wq
    const wq = (rho * serviceMeanTime * (1 + Cs_squared)) / (2 * (1 - rho));
    const lq = lambda * wq;
    const ws = wq + serviceMeanTime;
    const ls = lambda * ws;
    
    return { rho, lq, wq, ws, ls, Cs_squared };
}

// M/G/c (c>1): Allen-Cunneen approximation
function calculateMGCParams(lambda, serviceMeanTime, c, shapeK) {
    const mu = 1 / serviceMeanTime;
    const rho = lambda / (c * mu);
    const Cs_squared = 1 / shapeK;
    
    // First calculate M/M/c parameters
    const mmParams = calculateMMcParams(lambda, mu, c);
    
    // Allen-Cunneen approximation for Wq in M/G/c
    const wq = mmParams.wq * ((1 + Cs_squared) / 2);
    const lq = lambda * wq;
    const ws = wq + serviceMeanTime;
    const ls = lambda * ws;
    
    return { rho, lq, wq, ws, ls, Cs_squared };
}

// Helper: M/M/c calculations (for approximation)
function calculateMMcParams(lambda, mu, c) {
    let sum = 0;
    for (let n = 0; n < c; n++) {
        sum += Math.pow(lambda / mu, n) / factorial(n);
    }
    const rho = lambda / (c * mu);
    const p0 = 1 / (sum + (Math.pow(lambda / mu, c) / (factorial(c) * (1 - rho))));
    const lq = (p0 * Math.pow(lambda / mu, c) * rho) / (factorial(c) * Math.pow(1 - rho, 2));
    const wq = lq / lambda;
    const ws = wq + (1 / mu);
    const ls = lambda * ws;
    
    return { rho, p0, lq, wq, ws, ls };
}

// ==================== CHART GENERATION ====================
function generateGraphs(data) {
    if (!data) return;
    
    if (!SimulationState.googleChartsLoaded) {
        console.log('Google Charts not loaded yet, storing data for later...');
        SimulationState.pendingChartData = data;
        showToast('Loading chart library...', 'info', 2000);
        return;
    }
    
    drawArrivalChart(data.arrival || []);
    drawServiceTimeChart(data.service || [], data.shapeK || 1);
    drawTurnAroundTimeChart(data.turnAround || []);
    drawQueueLengthChart(data.queueLength || []);
}

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
            title: 'Poisson Arrival Pattern',
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

function drawServiceTimeChart(serviceTimes, shapeK) {
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
            title: `Gamma Service Times (Shape k = ${shapeK.toFixed(1)})`,
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
                    <div class="mt-2 pt-2 border-top">
                        <small class="text-muted">Gamma service times</small>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(col);
    }
}

// ==================== UI HELPERS ====================
function validateInputs() {
    const requiredFields = ['simulation-time', 'mean-arrival', 'service-mean-time', 'service-shape-k'];
    for (const field of requiredFields) {
        const input = document.getElementById(field);
        if (!input.value || parseFloat(input.value) <= 0) {
            showToast(`Please enter a valid value for ${field.replace('-', ' ')}`, 'warning', 3000);
            input.focus();
            return false;
        }
    }
    
    const shapeK = parseFloat(document.getElementById('service-shape-k').value);
    if (shapeK < 0.1) {
        showToast('Shape parameter (k) must be ≥ 0.1', 'warning', 3000);
        document.getElementById('service-shape-k').focus();
        return false;
    }
    
    return true;
}

function resetSimulation() {
    if (!confirm('Reset simulation? All current results will be lost.')) return;
    
    document.getElementById('simulation-time').value = '480';
    document.getElementById('mean-arrival').value = '5';
    document.getElementById('service-mean-time').value = '6';
    document.getElementById('service-shape-k').value = '1';
    
    document.getElementById('simulation_table').innerHTML = `
        <tr>
            <td colspan="10" class="text-center py-5 text-muted">
                <i class="fas fa-play-circle fa-3x mb-3 opacity-50"></i>
                <p class="fs-5 fw-bold mb-1">Ready for M/G/c Simulation</p>
                <p class="mb-0">Configure Gamma parameters and click "Run Simulation"</p>
            </td>
        </tr>
    `;
    
    document.getElementById('cp_table').innerHTML = `
        <tr>
            <td colspan="3" class="text-center py-5 text-muted">
                <i class="fas fa-chart-line fa-3x mb-3 opacity-50"></i>
                <p class="fs-5 fw-bold mb-1">Poisson Arrival Distribution</p>
                <p class="mb-0">Run simulation to generate inter-arrival probability table</p>
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
            <p class="text-muted">Select M/G/c model and configure Gamma parameters</p>
        </div>
    `;
    
    ['linechart', 'linechart-service', 'linechart-turnAround', 'queue-length-chart'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<div class="text-center py-5 text-muted">Chart will appear after simulation</div>';
    });
    
    SimulationState.simulationData = null;
    SimulationState.charts = {};
    SimulationState.pendingChartData = null;
    
    document.querySelectorAll('.model-option').forEach(opt => opt.classList.remove('active'));
    document.querySelector('.model-option[data-model="M/G/1"]').classList.add('active');
    SimulationState.currentModel = 'M/G/1';
    document.getElementById('selected-model-display').innerHTML = `
        <div class="selected-model-header">
            <i class="fas fa-check-circle me-2"></i>Selected Model:
        </div>
        <div class="badge bg-primary">M/G/1</div>
    `;
    
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
            maxWidth: '450px'
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
    document.getElementById('service-mean-time').value = '6';
    document.getElementById('service-shape-k').value = '1';
    validateUtilization();
}

// ==================== EVENT LISTENERS ====================
function initializeEventListeners() {
    document.getElementById('calculate-btn')?.addEventListener('click', runSimulation);
    document.getElementById('reset-btn')?.addEventListener('click', resetSimulation);
    document.getElementById('help-btn')?.addEventListener('click', showHelp);
    document.getElementById('help-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        showHelp();
    });
    
    document.querySelector('.export-data-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        if (SimulationState.simulationData) {
            exportSimulationData();
        } else {
            showToast('No simulation data to export. Run an M/G/c simulation first.', 'warning', 3000);
        }
    });
    
    document.getElementById('toggle-animation')?.addEventListener('click', () => {
        SimulationState.isAnimating = !SimulationState.isAnimating;
        document.getElementById('toggle-animation').innerHTML = `
            <i class="fas ${SimulationState.isAnimating ? 'fa-pause' : 'fa-play'} me-1"></i> 
            ${SimulationState.isAnimating ? 'Pause Animation' : 'Animate Charts'}
        `;
        if (SimulationState.simulationData) redrawAllCharts();
    });
    
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
}

// ==================== EXPORT FUNCTIONALITY ====================
function exportSimulationData() {
    if (!SimulationState.simulationData) {
        showToast('No simulation data available', 'warning', 3000);
        return;
    }
    
    const shapeK = document.getElementById('service-shape-k').value;
    const data = {
        model: SimulationState.currentModel,
        parameters: {
            simulationTime: document.getElementById('simulation-time').value,
            arrivalMean: document.getElementById('mean-arrival').value,
            serviceMeanTime: document.getElementById('service-mean-time').value,
            shapeK: shapeK
        },
        timestamp: new Date().toISOString(),
        stats: {
            totalCustomers: document.getElementById('stat-arrivals').textContent,
            utilization: document.getElementById('stat-utilization').textContent,
            avgWait: document.getElementById('stat-wait').textContent,
            avgTurnaround: document.getElementById('stat-turnaround').textContent
        },
        theoretical: {
            lq: document.getElementById('kpi-lq').textContent,
            wq: document.getElementById('kpi-wq').textContent,
            ws: document.getElementById('kpi-ws').textContent,
            ls: document.getElementById('kpi-ls').textContent
        }
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `carrefour_mgc_simulation_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast('M/G/c simulation data exported successfully!', 'success', 3000);
}

// ==================== UTILITY ====================
function redrawAllCharts() {
    if (SimulationState.simulationData && SimulationState.googleChartsLoaded) {
        generateGraphs(SimulationState.simulationData);
    }
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
                        drawServiceTimeChart(SimulationState.simulationData.service, SimulationState.simulationData.shapeK);
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