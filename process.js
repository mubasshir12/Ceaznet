const fs = require('fs');

const rawData = fs.readFileSync('./raw_data.js', 'utf8');
const lines = rawData.split('\n').filter(l => l.trim().length > 0 && !l.includes('const text =') && !l.includes('console.log'));

const transactions = [];
let currentTransaction = null;
let currentNote = '';

// Helper to parse dates
function parseDate(dateStr, timeStr) {
    const months = { 'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5, 'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11 };
    const [day, monthStr, year] = dateStr.split(' ');
    const [time, ampm] = timeStr.split(' ');
    let [hours, mins] = time.split(':').map(Number);
    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
    
    return new Date(parseInt(year), months[monthStr], parseInt(day), hours, mins);
}

// "23 Mar 2026 5:28 PM" is the cutoff
const cutoffDate = new Date(2026, 2, 23, 17, 28); 

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Look for lines that start with a date like "16 May 2026 11:18 AM"
    const dateMatch = line.match(/^(\d{1,2} [A-Z][a-z]{2} \d{4}) (\d{1,2}:\d{2} [AM|PM]{2}) (.*) (Bank of Baroda - \d{4}|INDUSIND BANK LIMITED - \d{4}) ₹([\d,\.]+)($| Note: (.*)$)/);
    
    if (dateMatch) {
        const [_, dateStr, timeStr, desc, account, amountStr, __, inlineNote] = dateMatch;
        
        let type = 'expense';
        let description = desc;
        if (desc.startsWith('Received from')) {
            type = 'income';
        } else if (desc.startsWith('Paid to')) {
            type = 'expense';
            description = desc.replace('Paid to ', '');
        } else if (desc.startsWith('Self Transferred')) {
            type = 'transfer';
        } else if (desc.startsWith('Recharge')) {
            type = 'expense';
        }

        const dateObj = parseDate(dateStr, timeStr);
        let note = inlineNote || '';
        
        // Wait, some notes are on the next line
        const tx = {
            dateObj,
            account,
            description,
            amount: parseFloat(amountStr.replace(/,/g, '')),
            type,
            note
        };
        transactions.push(tx);
    }
}

// Filter to only Bank of Baroda and after cutoff
const filtered = transactions.filter(t => 
    t.account.includes('Bank of Baroda') && 
    t.dateObj > cutoffDate
);

console.log(`Parsed ${transactions.length} total, ${filtered.length} matching Bank of Baroda and after cutoff.`);

// Heuristic categorization
function categorize(t) {
    const d = (t.description + ' ' + (t.note||'')).toLowerCase();
    if (d.includes('petrol') || d.includes('fuel')) return 'Fuel';
    if (d.includes('rick') || d.includes('rikshaw') || d.includes('rik') || d.includes('bus') || d.includes('train') || d.includes('uts') || d.includes('ticket') || d.includes('rail') || d.includes('fare')) return 'Transport';
    if (d.includes('chai') || d.includes('cafe')) return 'Chai';
    if (d.includes('pizza') || d.includes('food') || d.includes('restaurant') || d.includes('hotel') || d.includes('biriyani') || d.includes('sandwich') || d.includes('pav') || d.includes('rice') || d.includes('snack') || d.includes('paneer') || d.includes('bakery')) return 'Food';
    if (d.includes('water') || d.includes('juice') || d.includes('cola') || d.includes('milk') || d.includes('dairy') || d.includes('falooda') || d.includes('lassi') || d.includes('frooti')) return 'Dairy';
    if (d.includes('grocery') || d.includes('shop') || d.includes('market') || d.includes('store') || d.includes('super market')) return 'Groceries';
    if (d.includes('salary') || d.includes('payment') || d.includes('receive')) return 'Refund'; // as income
    if (t.type === 'transfer') return 'Transfer';
    return 'Other';
}

const finalJson = filtered.map(t => {
    let cat = categorize(t);
    // Correct income categories if needed
    if (t.type === 'income' && cat === 'Other') cat = 'Other';
    else if (t.type === 'expense' && cat === 'Other' && t.description.toLowerCase().includes('recharge')) cat = 'Mobile';

    return {
        id: crypto.randomUUID ? crypto.randomUUID() : 'tx-' + Math.random().toString(36).substr(2, 9),
        amount: t.amount,
        type: t.type,
        category: cat,
        description: t.description + (t.note ? (' - ' + t.note) : ''),
        payment_method: 'UPI',
        transaction_date: t.dateObj.toISOString()
    };
});

fs.writeFileSync('output.json', JSON.stringify(finalJson, null, 2));
console.log('Saved to output.json');
