'use strict';
var current = null;

/** Load only a PostgreSQL summary DTO and display offline/login errors explicitly. */
async function loadReport() {
    var day = document.getElementById('night').value;
    if (!day) return;
    var page = document.getElementById('page');
    try {
        var response = await fetch('/api/activity/night?date=' + encodeURIComponent(day));
        var report = await response.json();
        if (!response.ok) throw new Error(report.code || 'cloud_offline');
        current = report;
        page.innerHTML = window.ICBReport.render(report);
    } catch (error) {
        current = null;
        page.textContent =
            'Report unavailable: ' +
            error.message +
            '. Open Cloud account to check login and sync.';
    }
}

/** Export only the currently selected day's stored summaries. */
function downloadCsv() {
    if (!current) return;
    var blob = new Blob([window.ICBReport.csv(current)], { type: 'text/csv;charset=utf-8' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'icb-summary-' + current.date + '.csv';
    link.click();
    setTimeout(function () {
        URL.revokeObjectURL(link.href);
    }, 1000);
}

/** Populate known cloud days; an unavailable cloud is never represented as zero activity. */
async function bootReport() {
    var selector = document.getElementById('night');
    selector.addEventListener('change', loadReport);
    try {
        var response = await fetch('/api/activity/nights');
        var data = await response.json();
        if (!response.ok) throw new Error(data.code || 'cloud_offline');
        var days = data.nights.length ? data.nights : [data.tonight];
        days.forEach(function (date) {
            var option = document.createElement('option');
            option.value = date;
            option.textContent = date;
            selector.appendChild(option);
        });
        await loadReport();
    } catch (error) {
        document.getElementById('page').textContent =
            'Report unavailable: ' + error.message + '. Open Cloud account to sign in.';
    }
}

bootReport();
