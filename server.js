import express from 'express';
import fetch from 'node-fetch';
import sqlite3 from 'sqlite3';
import cors from 'cors';

sqlite3.verbose();
const app = express();
app.use(cors());

const db = new sqlite3.Database('database.db');

async function fetchDataAndInsertIntoDB() {
    try {
        const response = await fetch('https://s3.amazonaws.com/roxiler.com/product_transaction.json');
        const data = await response.json();
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY,
                title TEXT,
                price FLOAT,
                description TEXT,
                category TEXT,
                image TEXT,
                sold INT,
                dateOfSale DATE
            )`);

            const insertStmt = db.prepare('INSERT INTO transactions (title, price, description, category, image, sold, dateOfSale) VALUES (?, ?, ?, ?, ?, ?, ?)');
            data.forEach(product => {
                insertStmt.run(product.title, product.price, product.description, product.category, product.image, product.sold, product.dateOfSale);
            });
            insertStmt.finalize();

            console.log('Data inserted into SQLite table.');
        });
    } catch (error) {
        console.error('Error fetching or processing data:', error);
    }
}

fetchDataAndInsertIntoDB();

app.get('/all', async (req, res) => {
    db.all(`SELECT * FROM transactions`, (err, rows) => {
        if (err) {
            console.error(err.message);
            res.status(400).send('Internal server error');
        } else {
            res.json(rows);
        }
    });
});

// get api depends on search input and month
app.get('/search/month', async (req, res) => {
    const { searchInput, dropDownInput = "03" } = req.query;
    db.all(`SELECT * FROM transactions WHERE (title LIKE '%' || ? || '%' OR description LIKE '%' || ? || '%' OR price LIKE '%' || ? || '%') AND (strftime("%m", dateOfSale) = ?)`, [searchInput, searchInput, searchInput, dropDownInput], (err, rows) => {
        if (err) {
            console.error(err.message);
            res.status(400).send('Internal server error');
        } else {
            res.json(rows);
        }
    });
});

app.get('/search', async (req, res) => {
    const { searchInput = "" } = req.query;
    db.all(`SELECT * FROM transactions WHERE (title LIKE '%' || ? || '%' OR description LIKE '%' || ? || '%' OR price LIKE '%' || ? || '%')`, [searchInput, searchInput, searchInput], (err, rows) => {
        if (err) {
            console.error(err.message);
            res.status(400).send('Internal server error');
        } else {
            res.json(rows);
        }
    });
});

// get api depends on search input or pagination
app.get('/search/pagination', async (req, res) => {
    try {
        const { searchInput, page = 1, perPage = 10 } = req.query;
        let query = `SELECT * FROM transactions`;

        if (searchInput) {
            query += ` WHERE (title LIKE '%${searchInput}%' OR description LIKE '%${searchInput}%' OR price LIKE '%${searchInput}%')`;
        }

        const startIndex = (page - 1) * perPage;
        query += ` LIMIT ${perPage} OFFSET ${startIndex}`;

        db.all(query, (err, rows) => {
            if (err) {
                console.error(err.message);
                res.status(500).send('Internal server error');
            } else {
                res.json(rows);
            }
        });
    } catch (error) {
        console.error(error);
        res.status(400).send('Internal server error');
    }
});

// API for statistics of selected month
app.get('/statistics', async (req, res) => {
    try{
        const {dropDownInput = "03"} = req.query;
        const query = `
        SELECT
            SUM(CASE WHEN sold = 1 THEN price ELSE 0 END) AS totalSaleAmount,
            COUNT(CASE WHEN sold = true THEN 1 END) AS totalSoldItems,
            COUNT(CASE WHEN sold = false THEN 1 END) AS totalNotSoldItems
        FROM transactions
        WHERE strftime('%m', dateOfSale) = ?
        `
        db.get(query, [dropDownInput], (err, rows) => {
            if (err) {
                console.error(err.message);
                res.status(500).send('Internal server error');
            } else {
                res.json(rows);
            }
        });
    } catch (error) {
        console.error(error);
        res.status(400).send('Internal server error');
    }
})

// API for pie chart: Unique categories and number of items
app.get('/pie-chart-category', async (req, res) => {
    try {
        const { dropDownInput = "03" } = req.query;
        const query = `
            SELECT
                category,
                COUNT(*) AS itemCount
            FROM transactions
            WHERE strftime('%m', dateOfSale) = ?
            GROUP BY category
        `;
        db.all(query, [dropDownInput], (err, rows) => {
            if (err) {
                console.error(err.message);
                res.status(500).send('Internal server error');
            } else {
                const pieChartData = rows.map(row => ({
                    category: row.category,
                    itemCount: row.itemCount
                }));
                res.json(pieChartData);
            }
        });
    } catch (error) {
        console.error(error);
        res.status(400).send('Internal server error');
    }
});

// API for bar chart: Price range and number of items
app.get('/bar-chart-price-range', async (req, res) => {
    try {
        const { dropDownInput = "03" } = req.query;
        const query = `
            SELECT
                CASE
                    WHEN price >= 0 AND price <= 100 THEN '0 - 100'
                    WHEN price >= 101 AND price <= 200 THEN '101 - 200'
                    WHEN price >= 201 AND price <= 300 THEN '201 - 300'
                    WHEN price >= 301 AND price <= 400 THEN '301 - 400'
                    WHEN price >= 401 AND price <= 500 THEN '401 - 500'
                    WHEN price >= 501 AND price <= 600 THEN '501 - 600'
                    WHEN price >= 601 AND price <= 700 THEN '601 - 700'
                    WHEN price >= 701 AND price <= 800 THEN '701 - 800'
                    WHEN price >= 801 AND price <= 900 THEN '801 - 900'
                    ELSE '901-above'
                END AS priceRange,
                COUNT(*) AS itemCount
            FROM transactions
            WHERE strftime('%m', dateOfSale) = ?
            GROUP BY priceRange
            ORDER BY MIN(price)
        `;
        db.all(query, [dropDownInput], (err, rows) => {
            if (err) {
                console.error(err.message);
                res.status(500).send('Internal server error');
            } else {
                const barChartData = rows.map(row => ({
                    priceRange: row.priceRange,
                    itemCount: row.itemCount
                }));
                res.json(barChartData);
            }
        });
    } catch (error) {
        console.error(error);
        res.status(400).send('Internal server error');
    }
});

// API for combined data
app.get('/combined-data', async (req, res) => {
    try {
        const { dropDownInput } = req.query;

        const statisticsResponse = await fetch(`http://localhost:7575/statistics?dropDownInput=${dropDownInput}`);
        const barChartResponse = await fetch(`http://localhost:7575/bar-chart-price-range?dropDownInput=${dropDownInput}`);
        const pieChartResponse = await fetch(`http://localhost:7575/pie-chart-category?dropDownInput=${dropDownInput}`);

        const statistics = await statisticsResponse.json();
        const barChart = await barChartResponse.json();
        const pieChart = await pieChartResponse.json();

        const combinedData = {
            statistics: statistics,
            barChart: barChart,
            pieChart: pieChart
        };

        res.json(combinedData);
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).send('Internal server error');
    }
});

app.listen(7575, (err, res) => {
    if (err) {
        console.error(err.message)
        res.status(400).send('Interna server error')
    } else{
        console.log('Server is running on port 7575');
    }
});