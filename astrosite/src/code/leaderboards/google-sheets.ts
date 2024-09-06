import { google, sheets_v4 } from 'googleapis'
import { JWT, auth } from 'google-auth-library'
import type { BodyResponseCallback } from '@googleapis/sheets'
import type { IndividualLeaderboard, TeamLeaderboard } from './types'

type Rows = Array<Row>
type Row = Array<CellValue>
type CellValue = number|string|undefined
type CellReference = { row: number, column: number, name: string }


const columnNames = (() => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")
    return alphabet.concat(alphabet.flatMap(firstChar => alphabet.map(secondChar => `${firstChar}${secondChar}`)))
})()

const googleCredentials = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}')

const columnName = (index: number): string => columnNames[index] || `${index}?`

const authenticate = async (): Promise<sheets_v4.Sheets> => {
    const client = <JWT> auth.fromJSON(googleCredentials)
    client.scopes = ["https://www.googleapis.com/auth/spreadsheets"]
    return google.sheets({ version: 'v4', auth: client })
}

const findCellContaining = (rows: Rows, matcher: (value: CellValue) => boolean) => {
    for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < rows[r].length; c++) {
            const value = rows[r][c]
            if (!value) {
                continue
            }
            const match = () => ({ name: `${columnName(c)}${r + 1}`, row: r, column: c })
            if (typeof(matcher) === 'string') {
                if (matcher === value.toString()) return match()
            } else if (typeof(matcher) === 'function') {
                if (matcher(value)) return match()
            } else {
                console.error(`Invalid matcher type: ${typeof(matcher)}: ${JSON.stringify(matcher)}`)
            }
        }
    }
    return undefined
}

const findCellBelowContaining = (rows: Rows, cell: CellReference, matcher: (value: CellValue) => boolean) => {
    for (let r = cell.row + 1; r < rows.length; r++) {
        const value = rows[r][cell.column]
        if (!value) {
            continue
        }
        const match = () => ({ name: `${columnName(cell.column)}${r + 1}`, row: r, column: cell.column })
        if (typeof(matcher) === 'string') {
            if (matcher === value.toString()) return match()
        } else if (typeof(matcher) === 'function') {
            if (matcher(value)) return match()
        } else {
            console.error(`Invalid matcher type: ${typeof(matcher)}: ${JSON.stringify(matcher)}`)
        }
    }
    return undefined
}

const findEmptyCellBelow = (rows: Rows, cell: CellReference) => {
    for (let nextBelow = cellBelow(cell); !!nextBelow; nextBelow = cellBelow(nextBelow)) {
        if (cellValueSafe(rows, nextBelow) === '') {
            return nextBelow
        }
    }
    throw new Error(`WTF? There must be an empty cell *somewhere* below ${columnName(cell.column)}${cell.row+1}!`)
}

const findEmptyCellToRightOf = (rows: Rows, cell: CellReference) => {
    for (let nextRight = cellToRightOf(cell); !!nextRight; nextRight = cellToRightOf(nextRight)) {
        if (cellValueSafe(rows, nextRight) === '') {
            return nextRight
        }
    }
    throw new Error(`WTF? There must be an empty cell *somewhere* to the right of ${cell.name}!`)
}

const cellAbove = (cell: CellReference): CellReference => ({ ...cell, row: cell.row - 1, name: `${columnName(cell.column)}${cell.row}` })
const cellBelow = (cell: CellReference): CellReference => ({ ...cell, row: cell.row + 1, name: `${columnName(cell.column)}${cell.row + 2}` })
const cellToRightOf = (cell: CellReference): CellReference => ({ ...cell, column: cell.column + 1, name: `${columnName(cell.column + 1)}${cell.row + 1}` })
const cellToLeftOf = (cell: CellReference): CellReference => ({ ...cell, column: cell.column - 1, name: `${columnName(cell.column - 1)}${cell.row + 1}` })
const cellValue = (rows: Rows, cell: CellReference) => {
    const row = rows[cell.row]
    if (row === undefined) return undefined
    return row[cell.column]
}
const cellValueSafe = (rows: Rows, cell: CellReference) => {
    const value = cellValue(rows, cell)
    if (value === undefined || value === null) return ''
    return value
}

const findVictorLeaderboard = (rows: Rows): string|undefined => {
    // Find the title cell
    const titleCell = findCellContaining(rows, (value) => { return value?.toString().toLowerCase().replace(/\s+/g, ' ').trim() === 'victor leaderboard' })
    if (!titleCell) {
        console.error(`Could not find the title cell of the Victor leaderboard!`)
        return undefined
    }

    // Find the header row (somewhere below the title)
    const firstHeaderCell = findCellBelowContaining(rows, titleCell, (value) => value?.toString().toLowerCase().trim() === 'player')
    if (firstHeaderCell && cellValueSafe(rows, firstHeaderCell).toString().toLowerCase().trim() !== 'player') {
        console.error(`Could not find the first header cell in the Victor leaderboard – ${firstHeaderCell.name} value is ${JSON.stringify(rows[firstHeaderCell.row][firstHeaderCell.column])}!`)
        return undefined
    }

    // Find the first data row (immediately below the header row)
    const firstDataCell = cellBelow(firstHeaderCell!)
    if (cellValueSafe(rows, firstDataCell).toString().toLowerCase().trim() === '') {
        console.error(`Could not find the first data row in the Victor leaderboard – ${firstDataCell.name} value is ${JSON.stringify(rows[firstDataCell.row][firstDataCell.column])}!`)
        return undefined
    }

    const firstEmptyCellBelowHeader = findEmptyCellBelow(rows, firstHeaderCell!)
    let lastDataCell = cellAbove(firstEmptyCellBelowHeader)
    if (cellValueSafe(rows, lastDataCell).toString().toLowerCase().trim() === '') {
        console.error(`Could not find the last data row in the Victor leaderboard – ${lastDataCell.name} value is ${JSON.stringify(rows[lastDataCell.row][lastDataCell.column])}!`)
        return undefined
    }

    // look for the last non-empty cell to the right of the last known data cell
    const firstEmptyCellToRightOfLastDataCell = findEmptyCellToRightOf(rows, lastDataCell)
    lastDataCell = cellToLeftOf(firstEmptyCellToRightOfLastDataCell)
    if (cellValueSafe(rows, lastDataCell).toString().toLowerCase().trim() === '') {
        console.error(`Could not find the last column fo the last data row in the Victor leaderboard – ${lastDataCell.name} value is ${JSON.stringify(rows[lastDataCell.row][lastDataCell.column])}!`)
        return undefined
    }

    return `${firstDataCell.name}:${lastDataCell.name}`
}

const findHectorLeaderboard = (rows: Rows) => {
    for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < rows[r].length; c++) {
            if (!rows[r][c]) {
                continue
            }
            const value = rows[r][c]?.toString().toLowerCase().replace(/\s+/g, ' ').trim()
            if (value === 'hector leaderboard') {
                // console.log(`${columnName(c)}${r + 1}:\t${JSON.stringify(rows[r][c])} -> found the leaderboard title in column ${columnName(c)}`)
                let state = 'looking for header row'
                let firstHeaderCell = undefined
                let firstDataCell = undefined
                let lastDataCell = undefined
                for (let r2 = r + 1; r2 < rows.length; r2++) {
                    const value = rows[r2][c]
                    if (state === 'looking for header row') {
                        if (value && value.toString().toLowerCase().replace(/\s+/g, ' ').trim() === 'points') {
                            // console.log(`${columnName(c)}${r2 + 1}:\t${JSON.stringify(value)} -> marking as header row`)
                            firstHeaderCell = `${columnName(c)}${r2 + 1}`
                            state = 'looking for first data row'
                        } else {
                            // console.log(`${columnName(c)}${r2 + 1}:\t${JSON.stringify(value)} -> continuing to next row`)
                        }
                    } else if (state === 'looking for first data row') {
                        if (value && value.toString().trim() !== '') {
                            firstDataCell = `${columnName(c)}${r2 + 1}`
                            lastDataCell = `${columnName(c)}${r2 + 2}`
                            // console.log(`${columnName(c)}${r2 + 1}:\t${JSON.stringify(value)} -> marking ${firstDataCell} as the first data cell`)
                            state = 'looking for last data row'
                        } else {
                            console.warn(`Could not find data rows below the header row (${firstHeaderCell})!`)
                        }
                    } else if (state === 'looking for last data row') {
                        if (value && value.toString().trim() !== '') {
                            for (let c2 = c + 1; c2 < rows[r2].length; c2++) {
                                const value2 = rows[r2][c2]
                                if (value2) {
                                    lastDataCell = `${columnName(c2)}${r2 + 1}`
                                    // console.log(`${columnName(c)}${r2 + 1}:\t${JSON.stringify(value)} -> updating ${lastDataCell} as the last data cell`)
                                } else {
                                    break
                                }
                            }
                        } else {
                            // console.log(`${columnName(c)}${r2 + 1}:\t${JSON.stringify(value)} -> finalizing ${lastDataCell} as the last data cell`)
                            break
                        }
                    }
                }
                console.log(`Returning Hector leaderboard data range as ${firstDataCell}:${lastDataCell}`)
                return `${firstDataCell}:${lastDataCell}`
            }
        }
    }
    console.log(`Returning Hector leaderboard data range as undefined`)
    return undefined
}

type RowsProcessingFunction = (rows: Rows) => any

const processRangeInSheet = async (spreadsheetId: string, range: string, operation: RowsProcessingFunction): Promise<any> => {
    return new Promise(async (resolve, reject) => {
        try {
            const sheets = await authenticate()
            const callback: BodyResponseCallback<sheets_v4.Schema$ValueRange> = (err: any, res: any) => {
                if (err) {
                    if (err.response?.status === 403) {
                        let msg = `Access to ${spreadsheetId} denied - check that you've shared the Google Sheet with the service account email address`
                        if (googleCredentials.client_email) msg += `: ${googleCredentials.client_email}`
                        console.error(msg)
                    } else {
                        console.error('The API returned an error.', err)
                    }
                    reject(err)
                } else {
                    const rows = res.data.values as Rows
                    if (rows.length === 0) {
                        console.log('No data found.')
                        reject('No data found.')
                    } else {
                        const result = operation(rows)
                        resolve(result)
                    }
                }
            }
            sheets.spreadsheets.values.get({ spreadsheetId, range }, callback)
        } catch (err) {
            console.error(`Error updating leaderboard`, err)
            reject(err)
        }
    })
}

const locateHectorLeaderboard = async (sheetId: string) => {
    const sheetName = 'HECTOR'
    const range = await processRangeInSheet(sheetId, `${sheetName}!A1:BB50`, findHectorLeaderboard)
    return `${sheetName}!${range}`
}

const locateVictorLeaderboard = async (sheetId: string) => {
    const sheetName = 'VICTOR'
    const range = await processRangeInSheet(sheetId, `${sheetName}!A1:BB50`, findVictorLeaderboard)
    return `${sheetName}!${range}`
}

export const fetchHectorLeaderboardData = async (sheetId: string): Promise<TeamLeaderboard> => {
    const hectorLeaderboardRange = await locateHectorLeaderboard(sheetId)
    if (hectorLeaderboardRange) {
        return await processRangeInSheet(sheetId, hectorLeaderboardRange, (rows) => {
            return rows.map(row => ({ points: row[0], diff: row[3] === undefined ? '' : row[3], team: row[2] }))
        })
    } else {
        console.warn(`Could not find Hector leaderboard`)
        return []
    }
}

export const fetchVictorLeaderboardData = async (sheetId: string): Promise<IndividualLeaderboard> => {
    const victorLeaderboardRange = await locateVictorLeaderboard(sheetId)
    if (victorLeaderboardRange) {
        return await processRangeInSheet(sheetId, victorLeaderboardRange, (rows) => {
            return rows.map(row => ({ player: row[0], points: row[1], diff: row[2] === undefined ? '' : row[2] }))
        })
    } else {
        console.warn(`Could not find Victor leaderboard`)
        return []
    }
}
