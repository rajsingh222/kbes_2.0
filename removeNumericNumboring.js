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

// Track changes for reporting
const results = {};

files.forEach(fileName => {
    const filePath = path.join(basePath, fileName);
    
    console.log(`\nProcessing: ${fileName}`);
    console.log('='.repeat(60));
    
    try {
        let content = fs.readFileSync(filePath, 'utf8');
        let originalContent = content;
        let stats = {
            file: fileName,
            replacements: 0,
            patterns: {
                'N.N.N.N.N+ pattern (5+ parts)': 0,
                'N.N.N.N) pattern (4 parts)': 0,
                'N.N.N) pattern (3 parts)': 0,
                'N.N) pattern (2 parts)': 0,
                'JSX comment patterns': 0
            },
            examples: []
        };
        
        // Helper function to count replacements
        function countAndReplace(regex, replacement, patternName) {
            let count = 0;
            const newContent = content.replace(regex, (match) => {
                count++;
                if (stats.examples.length < 3) {
                    stats.examples.push({
                        pattern: patternName,
                        before: match.trim(),
                        after: replacement
                    });
                }
                return replacement;
            });
            if (count > 0) {
                console.log(`  ${patternName}: ${count} replacements`);
                stats.patterns[patternName] = count;
                stats.replacements += count;
            }
            return newContent;
        }
        
        // Process patterns in order from longest to shortest to avoid partial replacements
        
        // 1. Handle longer patterns (5+ parts): N.N.N.N.N) and beyond - strip entirely
        // Including patterns without trailing space
        content = countAndReplace(
            /\b\d+(?:\.\d+){4,}\)\s?(?=\w|$)/g,
            '',
            'N.N.N.N.N+ pattern (5+ parts)'
        );
        
        // 2. Handle 4-part patterns: N.N.N.N) → iii)
        content = countAndReplace(
            /\b\d+\.\d+\.\d+\.\d+\)\s?/g,
            'iii) ',
            'N.N.N.N) pattern (4 parts)'
        );
        
        // 3. Handle 3-part patterns: N.N.N) → ii)
        content = countAndReplace(
            /\b\d+\.\d+\.\d+\)\s?/g,
            'ii) ',
            'N.N.N) pattern (3 parts)'
        );
        
        // 4. Handle 2-part patterns: N.N) → i)
        content = countAndReplace(
            /\b\d+\.\d+\)\s?/g,
            'i) ',
            'N.N) pattern (2 parts)'
        );
        
        // 5. Handle JSX comment patterns like /* 2.2 element → 2.2.1 locations → 2.2.1.1 orientations */
        // Strip out N.N, N.N.N, N.N.N.N references from comments
        let commentCount = 0;
        content = content.replace(
            /\/\*\s*[^*]*\b\d+(?:\.\d+)+(?:\s+[a-zA-Z\s→→]+\b\d+(?:\.\d+)+)*[^*]*\*\//g,
            (match) => {
                // Remove numeric patterns from the comment
                let cleaned = match
                    .replace(/\b\d+(?:\.\d+)+\s+/g, ''); // Remove N.N, N.N.N etc followed by space
                
                if (cleaned !== match) {
                    commentCount++;
                    if (stats.examples.length < 3) {
                        stats.examples.push({
                            pattern: 'JSX comment',
                            before: match.substring(0, 50) + (match.length > 50 ? '...' : ''),
                            after: cleaned.substring(0, 50) + (cleaned.length > 50 ? '...' : '')
                        });
                    }
                }
                return cleaned;
            }
        );
        
        if (commentCount > 0) {
            console.log(`  JSX comment patterns: ${commentCount} replacements`);
            stats.patterns['JSX comment patterns'] = commentCount;
            stats.replacements += commentCount;
        }
        
        // Write back the modified content only if changes were made
        if (content !== originalContent) {
            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`✓ File updated with ${stats.replacements} total replacement(s)`);
        } else {
            console.log('✓ No changes needed');
        }
        
        results[fileName] = stats;
        
    } catch (error) {
        console.error(`✗ Error processing ${fileName}: ${error.message}`);
        results[fileName] = { error: error.message };
    }
});

// Summary report
console.log('\n\n' + '='.repeat(60));
console.log('SUMMARY REPORT');
console.log('='.repeat(60));

let totalReplacements = 0;
Object.entries(results).forEach(([fileName, stats]) => {
    if (stats.error) {
        console.log(`\n${fileName}: ERROR - ${stats.error}`);
    } else {
        console.log(`\n${fileName}`);
        console.log(`  Total replacements: ${stats.replacements}`);
        if (stats.replacements > 0) {
            Object.entries(stats.patterns).forEach(([pattern, count]) => {
                if (count > 0) {
                    console.log(`    - ${pattern}: ${count}`);
                }
            });
            totalReplacements += stats.replacements;
            
            if (stats.examples.length > 0) {
                console.log('  Examples:');
                stats.examples.forEach((ex, idx) => {
                    console.log(`    ${idx + 1}. [${ex.pattern}]`);
                    console.log(`       Before: "${ex.before}"`);
                    console.log(`       After:  "${ex.after}"`);
                });
            }
        }
    }
});

console.log('\n' + '='.repeat(60));
console.log(`Total replacements across all files: ${totalReplacements}`);
console.log('='.repeat(60));
