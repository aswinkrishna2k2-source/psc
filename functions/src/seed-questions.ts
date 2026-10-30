import type { Difficulty, MediumId } from '../../shared/catalog.ts';
import { db, poolId, refs } from './firestore.ts';
import type { QuestionDoc } from './firestore.ts';
import { questionId, shuffleOptions } from './gemini.ts';

// A small hand-checked set so the app works before Gemini has written anything.
// The correct option is listed first and shuffled on insert.
type Seed = [subjectId: string, difficulty: Difficulty, question: string, options: [string, string, string, string], explanation: string];

const SEED_VERSION = 1;

const ENGLISH: Seed[] = [
  ['kerala-history', 'easy', 'Who was the first president of the SNDP Yogam, founded in 1903?', ['Sree Narayana Guru', 'Chattampi Swamikal', 'Ayyankali', 'Mannathu Padmanabhan'], 'Sree Narayana Guru was its founding president. Kumaran Asan served as its first general secretary.'],
  ['kerala-history', 'easy', 'The Vaikom Satyagraha began in which year?', ['1924', '1919', '1931', '1936'], 'It began on 30 March 1924, demanding that all castes could use the roads around the Vaikom temple.'],
  ['kerala-history', 'medium', 'The Temple Entry Proclamation of Travancore was issued in which year?', ['1936', '1924', '1931', '1947'], 'Sree Chithira Thirunal Balarama Varma issued it in November 1936.'],
  ['kerala-history', 'medium', 'Who led the Villuvandi (bullock cart) agitation?', ['Ayyankali', 'Pandit Karuppan', 'Vaikunda Swami', 'K. Kelappan'], 'Ayyankali rode a bullock cart on roads closed to lower castes in 1893 to assert the right to travel on them.'],
  ['kerala-history', 'medium', 'Who led the Guruvayur Satyagraha of 1931?', ['K. Kelappan', 'T. K. Madhavan', 'Ayyankali', 'C. Kesavan'], 'K. Kelappan led it and later undertook a fast for it. A. K. Gopalan was the captain of the volunteers.'],

  ['indian-history', 'easy', 'The Battle of Plassey was fought in which year?', ['1757', '1764', '1857', '1707'], 'Robert Clive defeated Siraj-ud-Daulah in 1757, a turning point for British power in Bengal.'],
  ['indian-history', 'easy', 'Who founded the Indian National Congress in 1885?', ['A. O. Hume', 'Dadabhai Naoroji', 'W. C. Bonnerjee', 'Bal Gangadhar Tilak'], 'A. O. Hume founded it. W. C. Bonnerjee presided over its first session in Bombay.'],
  ['indian-history', 'easy', 'The Jallianwala Bagh massacre took place in which year?', ['1919', '1915', '1922', '1930'], 'It took place at Amritsar on 13 April 1919, under the orders of General Dyer.'],
  ['indian-history', 'easy', 'The Quit India Movement was launched in which year?', ['1942', '1930', '1920', '1947'], 'Gandhiji launched it in Bombay in August 1942 with the call "Do or Die".'],
  ['indian-history', 'medium', 'Who was the first Governor-General of independent India?', ['Lord Mountbatten', 'C. Rajagopalachari', 'Lord Wavell', 'Dr. Rajendra Prasad'], 'Lord Mountbatten held the post first. C. Rajagopalachari was the first and only Indian to hold it.'],

  ['geography', 'easy', 'Which is the longest river in Kerala?', ['Periyar', 'Bharathapuzha', 'Pamba', 'Chaliyar'], 'Periyar is about 244 km long. Bharathapuzha is second at about 209 km.'],
  ['geography', 'easy', 'Which is the highest peak in Kerala?', ['Anamudi', 'Meesapulimala', 'Agasthyakoodam', 'Chembra'], 'Anamudi in Idukki rises to about 2,695 m and is also the highest peak in South India.'],
  ['geography', 'easy', 'How many districts does Kerala have?', ['14', '12', '13', '16'], 'Kerala has 14 districts. Kasaragod, formed in 1984, is the most recent.'],
  ['geography', 'medium', 'Which is the largest district in Kerala by area?', ['Palakkad', 'Idukki', 'Malappuram', 'Wayanad'], 'Palakkad is the largest by area, and Alappuzha is the smallest.'],
  ['geography', 'medium', 'Which is the largest freshwater lake in Kerala?', ['Sasthamkotta', 'Vembanad', 'Ashtamudi', 'Pookode'], 'Sasthamkotta in Kollam is the largest freshwater lake. Vembanad is the largest backwater.'],

  ['constitution', 'easy', 'Which article of the Constitution abolishes untouchability?', ['Article 17', 'Article 14', 'Article 19', 'Article 21'], 'Article 17 abolishes untouchability and forbids its practice in any form.'],
  ['constitution', 'easy', 'Who was the chairman of the Drafting Committee of the Constitution?', ['B. R. Ambedkar', 'Rajendra Prasad', 'Jawaharlal Nehru', 'K. M. Munshi'], 'Ambedkar chaired the committee. Rajendra Prasad presided over the Constituent Assembly.'],
  ['constitution', 'medium', 'The Right to Education is provided under which article?', ['Article 21A', 'Article 19', 'Article 32', 'Article 45'], 'Article 21A was added by the 86th Amendment in 2002 for children aged six to fourteen.'],
  ['constitution', 'medium', 'How many Fundamental Duties are listed in the Constitution?', ['11', '10', '9', '12'], 'Article 51A lists 11. Ten came with the 42nd Amendment and one with the 86th Amendment.'],
  ['constitution', 'easy', 'What is the minimum age to become President of India?', ['35 years', '25 years', '30 years', '40 years'], 'Article 58 sets the minimum age at 35 years.'],

  ['economics', 'easy', 'In which year was the Reserve Bank of India established?', ['1935', '1947', '1949', '1950'], 'The RBI began on 1 April 1935. It was nationalised in 1949.'],
  ['economics', 'easy', 'NITI Aayog replaced which body?', ['Planning Commission', 'Finance Commission', 'National Development Council', 'Election Commission'], 'NITI Aayog replaced the Planning Commission on 1 January 2015.'],
  ['economics', 'easy', 'The Goods and Services Tax came into effect in India on which date?', ['1 July 2017', '1 April 2017', '1 January 2016', '8 November 2016'], 'GST began on 1 July 2017, replacing many central and state indirect taxes.'],

  ['physics-chemistry', 'easy', 'What is the SI unit of electrical resistance?', ['Ohm', 'Volt', 'Ampere', 'Watt'], 'Resistance is measured in ohms, named after Georg Simon Ohm.'],
  ['physics-chemistry', 'easy', 'What is the chemical formula of common salt?', ['NaCl', 'KCl', 'CaCO3', 'Na2CO3'], 'Common salt is sodium chloride, NaCl.'],
  ['physics-chemistry', 'easy', 'Which gas is most abundant in the Earth\'s atmosphere?', ['Nitrogen', 'Oxygen', 'Carbon dioxide', 'Argon'], 'Nitrogen makes up about 78% of the atmosphere, and oxygen about 21%.'],
  ['physics-chemistry', 'medium', 'What is the approximate speed of light in a vacuum?', ['3 × 10⁸ m/s', '3 × 10⁶ m/s', '3 × 10⁵ m/s', '3 × 10¹⁰ m/s'], 'Light travels at about 3 × 10⁸ metres per second in a vacuum.'],

  ['biology', 'easy', 'Scurvy is caused by a lack of which vitamin?', ['Vitamin C', 'Vitamin A', 'Vitamin D', 'Vitamin K'], 'Vitamin C deficiency causes scurvy. Citrus fruits are a good source of it.'],
  ['biology', 'easy', 'Which is the largest organ of the human body?', ['Skin', 'Liver', 'Lungs', 'Small intestine'], 'The skin is the largest organ. The liver is the largest internal gland.'],
  ['biology', 'medium', 'Which blood group is known as the universal donor?', ['O negative', 'AB positive', 'A positive', 'B negative'], 'O negative red cells can be given to any group. AB positive is the universal recipient.'],
  ['biology', 'easy', 'Malaria is spread by which insect?', ['Female Anopheles mosquito', 'Female Aedes mosquito', 'Male Culex mosquito', 'Housefly'], 'The female Anopheles mosquito carries the Plasmodium parasite that causes malaria.'],

  ['arithmetic', 'easy', 'If 20% of a number is 40, what is the number?', ['200', '80', '160', '400'], '40 ÷ 0.20 = 200.'],
  ['arithmetic', 'easy', 'What is the simple interest on ₹1,000 at 10% per annum for 2 years?', ['₹200', '₹100', '₹210', '₹120'], 'Simple interest = 1000 × 10 × 2 ÷ 100 = ₹200.'],
  ['arithmetic', 'easy', 'A train travels 180 km in 3 hours. What is its speed?', ['60 km/h', '50 km/h', '90 km/h', '54 km/h'], 'Speed = distance ÷ time = 180 ÷ 3 = 60 km/h.'],
  ['arithmetic', 'medium', 'What comes next in the series 2, 6, 12, 20, 30, ...?', ['42', '40', '36', '44'], 'The differences are 4, 6, 8, 10, so the next is 12. 30 + 12 = 42.'],
  ['arithmetic', 'easy', 'Two numbers are in the ratio 3:5 and add up to 40. What is the larger number?', ['25', '15', '24', '30'], 'One part = 40 ÷ 8 = 5. The larger number is 5 × 5 = 25.'],

  ['english', 'easy', 'Choose the synonym of "abundant".', ['Plentiful', 'Scarce', 'Narrow', 'Silent'], '"Abundant" means existing in large quantities, the same as "plentiful".'],
  ['english', 'easy', 'Fill in the blank: He is ___ honest man.', ['an', 'a', 'the', 'no article'], '"Honest" begins with a vowel sound because the h is silent, so it takes "an".'],
  ['english', 'easy', 'Choose the antonym of "ancient".', ['Modern', 'Old', 'Historic', 'Aged'], '"Ancient" means very old, and its opposite is "modern".'],
  ['english', 'easy', 'A person who can speak two languages is called:', ['Bilingual', 'Bilateral', 'Biennial', 'Biped'], '"Bilingual" comes from "bi" (two) and "lingua" (tongue or language).'],
  ['english', 'medium', 'Choose the passive form of "She wrote a letter."', ['A letter was written by her.', 'A letter is written by her.', 'A letter has been written by her.', 'A letter was wrote by her.'], 'Simple past passive uses "was/were" with the past participle: "was written".'],

  ['it', 'easy', 'What does CPU stand for?', ['Central Processing Unit', 'Computer Processing Unit', 'Central Program Unit', 'Control Processing Utility'], 'The CPU carries out program instructions and is often called the brain of the computer.'],
  ['it', 'easy', 'Which of these is an input device?', ['Keyboard', 'Monitor', 'Printer', 'Speaker'], 'A keyboard sends data into the computer. The others present output.'],
  ['it', 'medium', 'The Information Technology Act of India was enacted in which year?', ['2000', '1995', '2005', '2008'], 'It was enacted in 2000 and significantly amended in 2008.'],

  ['arts-sports', 'easy', 'Who was the first Malayalam writer to win the Jnanpith Award?', ['G. Sankara Kurup', 'Thakazhi Sivasankara Pillai', 'S. K. Pottekkatt', 'M. T. Vasudevan Nair'], 'G. Sankara Kurup won the very first Jnanpith Award in 1965 for "Odakkuzhal".'],
  ['arts-sports', 'easy', 'Who wrote Adhyatma Ramayanam Kilippattu?', ['Thunchaththu Ezhuthachan', 'Cherusseri', 'Kunchan Nambiar', 'Unnayi Warrier'], 'Thunchaththu Ezhuthachan wrote it and is called the father of modern Malayalam.'],
];

const MALAYALAM: Seed[] = [
  ['kerala-history', 'easy', 'വൈക്കം സത്യാഗ്രഹം ആരംഭിച്ച വർഷം ഏത്?', ['1924', '1919', '1931', '1936'], '1924 മാർച്ച് 30-നാണ് വൈക്കം സത്യാഗ്രഹം ആരംഭിച്ചത്.'],
  ['kerala-history', 'easy', 'എസ്.എൻ.ഡി.പി. യോഗത്തിന്റെ ആദ്യ അധ്യക്ഷൻ ആര്?', ['ശ്രീനാരായണ ഗുരു', 'ചട്ടമ്പി സ്വാമികൾ', 'അയ്യങ്കാളി', 'മന്നത്ത് പത്മനാഭൻ'], '1903-ൽ രൂപീകരിച്ച യോഗത്തിന്റെ ആദ്യ അധ്യക്ഷൻ ശ്രീനാരായണ ഗുരുവും ആദ്യ ജനറൽ സെക്രട്ടറി കുമാരനാശാനുമായിരുന്നു.'],
  ['kerala-history', 'medium', 'വില്ലുവണ്ടി സമരം നയിച്ചത് ആര്?', ['അയ്യങ്കാളി', 'പണ്ഡിറ്റ് കറുപ്പൻ', 'വൈകുണ്ഠ സ്വാമികൾ', 'കെ. കേളപ്പൻ'], 'സഞ്ചാരസ്വാതന്ത്ര്യത്തിനായി 1893-ൽ അയ്യങ്കാളി വില്ലുവണ്ടി യാത്ര നടത്തി.'],
  ['geography', 'easy', 'കേരളത്തിലെ ഏറ്റവും നീളം കൂടിയ നദി ഏത്?', ['പെരിയാർ', 'ഭാരതപ്പുഴ', 'പമ്പ', 'ചാലിയാർ'], 'ഏകദേശം 244 കിലോമീറ്റർ നീളമുള്ള പെരിയാറാണ് കേരളത്തിലെ ഏറ്റവും നീളം കൂടിയ നദി.'],
  ['geography', 'easy', 'കേരളത്തിലെ ഏറ്റവും ഉയരം കൂടിയ കൊടുമുടി ഏത്?', ['ആനമുടി', 'മീശപ്പുലിമല', 'അഗസ്ത്യകൂടം', 'ചെമ്പ്ര'], 'ഇടുക്കി ജില്ലയിലെ ആനമുടിക്ക് ഏകദേശം 2,695 മീറ്റർ ഉയരമുണ്ട്.'],
  ['geography', 'easy', 'കേരളത്തിൽ എത്ര ജില്ലകളുണ്ട്?', ['14', '12', '13', '16'], 'കേരളത്തിൽ 14 ജില്ലകളുണ്ട്. 1984-ൽ രൂപീകരിച്ച കാസർകോടാണ് ഏറ്റവും പുതിയത്.'],
  ['constitution', 'easy', 'തൊട്ടുകൂടായ്മ നിർത്തലാക്കുന്ന ഭരണഘടനാ അനുച്ഛേദം ഏത്?', ['അനുച്ഛേദം 17', 'അനുച്ഛേദം 14', 'അനുച്ഛേദം 19', 'അനുച്ഛേദം 21'], 'അനുച്ഛേദം 17 തൊട്ടുകൂടായ്മ നിർത്തലാക്കുന്നു.'],
  ['constitution', 'easy', 'ഭരണഘടനയുടെ ഡ്രാഫ്റ്റിങ് കമ്മിറ്റി ചെയർമാൻ ആരായിരുന്നു?', ['ബി. ആർ. അംബേദ്കർ', 'രാജേന്ദ്ര പ്രസാദ്', 'ജവഹർലാൽ നെഹ്റു', 'കെ. എം. മുൻഷി'], 'ബി. ആർ. അംബേദ്കറായിരുന്നു ഡ്രാഫ്റ്റിങ് കമ്മിറ്റി ചെയർമാൻ.'],
  ['biology', 'easy', 'സ്കർവി രോഗത്തിന് കാരണം ഏത് വിറ്റാമിന്റെ കുറവാണ്?', ['വിറ്റാമിൻ സി', 'വിറ്റാമിൻ എ', 'വിറ്റാമിൻ ഡി', 'വിറ്റാമിൻ കെ'], 'വിറ്റാമിൻ സിയുടെ കുറവാണ് സ്കർവിക്ക് കാരണം.'],
  ['physics-chemistry', 'easy', 'വൈദ്യുത പ്രതിരോധത്തിന്റെ യൂണിറ്റ് ഏത്?', ['ഓം', 'വോൾട്ട്', 'ആമ്പിയർ', 'വാട്ട്'], 'വൈദ്യുത പ്രതിരോധം അളക്കുന്ന യൂണിറ്റാണ് ഓം.'],
  ['arithmetic', 'easy', 'ഒരു സംഖ്യയുടെ 20% 40 ആയാൽ സംഖ്യ എത്ര?', ['200', '80', '160', '400'], '40 ÷ 0.20 = 200.'],
  ['regional-language', 'easy', 'മലയാളത്തിലെ ആദ്യ ജ്ഞാനപീഠ ജേതാവ് ആര്?', ['ജി. ശങ്കരക്കുറുപ്പ്', 'തകഴി ശിവശങ്കരപ്പിള്ള', 'എസ്. കെ. പൊറ്റെക്കാട്ട്', 'എം. ടി. വാസുദേവൻ നായർ'], '"ഓടക്കുഴൽ" എന്ന കൃതിക്ക് 1965-ൽ ജി. ശങ്കരക്കുറുപ്പ് ആദ്യ ജ്ഞാനപീഠ പുരസ്കാരം നേടി.'],
  ['regional-language', 'easy', 'അധ്യാത്മരാമായണം കിളിപ്പാട്ട് രചിച്ചത് ആര്?', ['തുഞ്ചത്ത് എഴുത്തച്ഛൻ', 'ചെറുശ്ശേരി', 'കുഞ്ചൻ നമ്പ്യാർ', 'ഉണ്ണായി വാര്യർ'], 'ആധുനിക മലയാളത്തിന്റെ പിതാവ് എന്നറിയപ്പെടുന്ന തുഞ്ചത്ത് എഴുത്തച്ഛനാണ് രചയിതാവ്.'],
  ['regional-language', 'easy', 'തുള്ളൽ പ്രസ്ഥാനത്തിന്റെ ഉപജ്ഞാതാവ് ആര്?', ['കുഞ്ചൻ നമ്പ്യാർ', 'ചെറുശ്ശേരി', 'തുഞ്ചത്ത് എഴുത്തച്ഛൻ', 'ഉണ്ണായി വാര്യർ'], 'കുഞ്ചൻ നമ്പ്യാരാണ് തുള്ളൽ എന്ന കലാരൂപത്തിന്റെ ഉപജ്ഞാതാവ്.'],
];

async function writeSeeds() {
  const batch = db.batch();
  const add = (medium: MediumId, seeds: Seed[]) => {
    for (const [subjectId, difficulty, question, options, explanation] of seeds) {
      const shuffled = shuffleOptions(options, 0);
      const doc: QuestionDoc = {
        pool: poolId('any', subjectId, medium),
        rand: Math.random(),
        source: 'sample',
        examId: null,
        level: null,
        subjectId,
        topic: null,
        medium,
        difficulty,
        year: null,
        question,
        options: shuffled.options,
        correctIndex: shuffled.correctIndex,
        explanation,
        reportedBy: [],
        createdAt: Date.now(),
      };
      batch.set(refs.question(questionId(medium, question)), doc);
    }
  };
  add('en', ENGLISH);
  add('ml', MALAYALAM);
  batch.set(refs.meta('seed'), { version: SEED_VERSION });
  await batch.commit();
}

let seeded: Promise<void> | null = null;

// One read per cold start once seeded, so there is no separate setup step to remember.
export function ensureSeeded() {
  seeded ??= (async () => {
    const meta = await refs.meta('seed').get();
    if (meta.data()?.version !== SEED_VERSION) await writeSeeds();
  })().catch((error) => {
    seeded = null;
    throw error;
  });
  return seeded;
}
