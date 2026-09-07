import { type ChartItem, type ChartData, type Point } from 'chart.js'
import Chart from 'chart.js/auto'
import 'chartjs-adapter-luxon'


export function drawHandicapHistoryChart(elementId: string) {
    const ctx = document.getElementById(elementId)
    if (!ctx) throw new Error(`Element with id ${elementId} not found on page!`)

    const data: Array<{x: string, y: number}> = JSON.parse(ctx.dataset.handicapHistory || '[]') as Array<{x: string, y: number}>
    const currentHandicap = ctx.dataset.currentHandicap ? parseFloat(ctx.dataset.currentHandicap) : undefined

    // Match the app's palette: violet line, gold current-handicap badge, ink gridlines.
    const datasetLineColor = '#8b79d8'
    const datasetTickColor = '#cfc6f0'
    const badgeColor = '#e3b341'
    const gridColor = '#1d1c20'
    const axisTextColor = '#7c7a86'
    const dataset: Point[] = data.map((entry) => ({ x: new Date(entry.x).getTime(), y: entry.y }))
    const linedata: ChartData<"line"> = {
        datasets: [
            {
                label: 'Handicap',
                data: dataset,
                borderColor: datasetLineColor,
                tension: 0.1
            }
        ]
    }
    const currentHandicapPlugin = {
        id: 'currentHandicapPlugin',
        afterRender: (chart: Chart, _args: any, _options: any) => {
            // see: https://stackoverflow.com/questions/67712875/chart-js-3-3-0-draw-text-on-top-of-chart
            if (currentHandicap === undefined) { return; }

            const canvasSize = Math.max(chart?.canvas?.parentElement?.clientWidth || 0, chart?.canvas?.parentElement?.clientHeight || 0)
            const font = canvasSize > 400 ? '700 24px "Barlow Semi Condensed", sans-serif' : '700 16px "Barlow Semi Condensed", sans-serif'
            const radius = canvasSize > 400 ? 36 : 22
            const centerX = canvasSize > 400 ? 90 : 70
            const centerY = canvasSize > 400 ? 50 : 30
            const yDelta = canvasSize > 400 ? 8 : 6

            const { ctx } = chart
            ctx.save()

            ctx.beginPath();
            ctx.fillStyle = badgeColor
            ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
            ctx.fill();
            ctx.restore();

            ctx.textAlign = 'center'
            ctx.font = font
            ctx.fillStyle = '#0a0a0c'
            ctx.fillText(Number(currentHandicap).toFixed(1), centerX, centerY + yDelta)
            ctx.restore()
        }
    }
    new Chart(ctx as ChartItem, {
         type: 'line',
         data: linedata,
         plugins: [ currentHandicapPlugin ],
         options: {
            locale: 'en',
            animation: false,
            elements: {
                point: {
                    radius: 3,
                    backgroundColor: datasetTickColor,
                    borderColor: datasetTickColor
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            },
             scales: {
                 x: {
                     type: 'time',
                     time: {
                        unit: 'day',
                        displayFormats: {
                            year: 'y',
                            month: 'y-MM',
                            day: 'y-MM-dd',
                        }
                     },
                     grid: { color: gridColor },
                     border: { color: gridColor },
                     ticks: { color: axisTextColor, font: { family: 'Inconsolata, monospace', size: 10 } }
                 },
                 y: {
                     grid: { color: gridColor },
                     border: { color: gridColor },
                     ticks: { color: axisTextColor, font: { family: 'Inconsolata, monospace', size: 10 } }
                 }
             }
         }
    })
}
drawHandicapHistoryChart('handicap-history-chart-canvas')
