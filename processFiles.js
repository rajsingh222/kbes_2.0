const fs = require('fs');
const path = require('path');

const basePath = 'c:\\Raj\\sppl react\\client\\oshas-standalone\\frontend\\src\\pages';

const files = [
    'AdvancedRCCAssessment.js',
    'AdvancedCompositeAssessment.js',
    'AdvancedHeritageAssessment.js',
    'AdvancedSteelAssessment.js',
    'AdvancedLoadBearingAssessment.js'
];

console.log('Starting numeric numbering removal...\n');

const results = {};

files.forEach(fileName => {
    const filePath = path.join(basePath, fileName);
    
    console.log(`\n${'='.repeat(70)}`);
    console.log(`Processing: ${fileName}`);
    console.log(`${'='.repeat(70)}`);
    
    try {
        let content = fs.readFileSync(filePath, 'utf8');
        const originalLength = content.length;
        let replacementCount = 0;
        const examples = [];
        
        // Helper to track replacements
        function replaceAndTrack(regex, replacement, patternName) {
            const before = content;
            content = content.replace(regex, (match) => {
                replacementCount++;
                if (examples.length < 5) {
                    examples.push({
                        pattern: patternName,
                        before: match.trim(),
                        after: replacement.trim()
                    });
                }
                return replacement;
            });
            const count = (before.match(regex) || []).length;
            if (count > 0) {
                console.log(`  ✓ ${patternName}: ${count} found`);
            }
            return count;
        }
        
        // Process in order: longest to shortest pattern
        console.log('\nApplying replacements (longest patterns first):\n');
        
        // 1. Pattern with 6+ dots (5+ segments): N.N.N.N.N.N) → strip
        replaceAndTrack(/\b\d+\.\d+\.\d+\.\d+\.\d+\.\d+\)\s*/g, '', 'N.N.N.N.N.N) and longer (6+ segments)');
        
        // 2. Pattern with 5 dots (4+ segments): N.N.N.N.N) → strip
        replaceAndTrack(/\b\d+\.\d+\.\d+\.\d+\.\d+\)\s*/g, '', 'N.N.N.N.N) (5 segments)');
        
        // 3. Pattern with 4 dots (4 segments): N.N.N.N) → iii)
        replaceAndTrack(/\b\d+\.\d+\.\d+\.\d+\)\s*/g, 'iii) ', 'N.N.N.N) (4 segments)');
        
        // 4. Pattern with 3 dots (3 segments): N.N.N) → ii)
        replaceAndTrack(/\b\d+\.\d+\.\d+\)\s*/g, 'ii) ', 'N.N.N) (3 segments)');
        
        // 5. Pattern with 2 dots (2 segments): N.N) → i)
        replaceAndTrack(/\b\d+\.\d+\)\s*/g, 'i) ', 'N.N) (2 segments)');
        
        // Write back only if changes were made
        if (replacementCount > 0) {
            fs.writeFileSync(filePath, content, 'utf8');
            const newLength = content.length;
            console.log(`\n✓ File saved (size: ${originalLength} → ${newLength} bytes, diff: ${newLength - originalLength})`);
            console.log(`\nTotal replacements: ${replacementCount}`);
            
            if (examples.length > 0) {
                console.log('\nSample replacements:');
                examples.forEach((ex, idx) => {
                    console.log(`  ${idx + 1}. [${ex.pattern}]`);
                    console.log(`     Before: "${ex.before}"`);
                    console.log(`     After:  "${ex.after}"`);
                });
            }
        } else {
            console.log('\n✓ No patterns found - file unchanged');
        }
        
        results[fileName] = {
            success: true,
            replacements: replacementCount,
            sizeChange: newLength - originalLength
        };
        
    } catch (error) {
        console.log(`✗ Error: ${error.message}`);
        results[fileName] = {
            success: false,
            error: error.message
        };
    }
});

// Final summary
console.log('\n\n' + '='.repeat(70));
console.log('FINAL SUMMARY');
console.log('='.repeat(70));

let totalReplacements = 0;
let processedFiles = 0;

Object.entries(results).forEach(([fileName, stats]) => {
    if (stats.success) {
        processedFiles++;
        totalReplacements += stats.replacements;
        const status = stats.replacements > 0 ? '✓' : '○';
        console.log(`${status} ${fileName}: ${stats.replacements} replacements (${stats.sizeChange > 0 ? '+' : ''}${stats.sizeChange} bytes)`);
    } else {
        console.log(`✗ ${fileName}: ${stats.error}`);
    }
});

console.log(`\n${'─'.repeat(70)}`);
console.log(`Files processed: ${processedFiles}/${files.length}`);
console.log(`Total replacements: ${totalReplacements}`);
console.log('='.repeat(70));
