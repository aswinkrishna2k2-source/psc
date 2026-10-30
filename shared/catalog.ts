// Everything a student can select. Edit this file to add exams, subjects or topics;
// the server validates against it and the UI renders from it.
// Syllabus weights are approximate and only shape how model exams are split by subject.

export type LevelId = 'sslc' | 'plus2' | 'degree';
export type MediumId = 'en' | 'ml' | 'ta' | 'kn';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type DifficultyChoice = Difficulty | 'mixed';
export type QuizKind = 'subject' | 'pyq' | 'mock' | 'mistakes';
export type QuizMode = 'practice' | 'test';

export type Level = { id: LevelId; name: string; hint: string };
export type Medium = { id: MediumId; name: string; native: string };
export type Subject = { id: string; name: string; topics: string[] };
export type SyllabusEntry = { subjectId: string; weight: number };
export type Exam = {
  id: string;
  name: string;
  level: LevelId;
  about: string;
  syllabus: SyllabusEntry[];
};

export const LEVELS: Level[] = [
  { id: 'sslc', name: '10th level', hint: 'Posts asking for SSLC or lower' },
  { id: 'plus2', name: 'Plus Two level', hint: 'Posts asking for Higher Secondary' },
  { id: 'degree', name: 'Degree level', hint: 'Posts asking for a graduate degree' },
];

export const MEDIUMS: Medium[] = [
  { id: 'en', name: 'English', native: 'English' },
  { id: 'ml', name: 'Malayalam', native: 'മലയാളം' },
  { id: 'ta', name: 'Tamil', native: 'தமிழ்' },
  { id: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ' },
];

export const SUBJECTS: Subject[] = [
  {
    id: 'kerala-history',
    name: 'Kerala History & Renaissance',
    topics: ['Ancient and medieval Kerala', 'Travancore, Cochin and Malabar', 'Renaissance leaders and movements', 'Freedom struggle in Kerala', 'Kerala after 1956'],
  },
  {
    id: 'indian-history',
    name: 'Indian History',
    topics: ['Ancient India', 'Medieval India', 'British rule and revolts', 'National movement', 'India after independence'],
  },
  {
    id: 'geography',
    name: 'Geography',
    topics: ['Physical geography of Kerala', 'Rivers, lakes and backwaters', 'Geography of India', 'World geography', 'Climate and natural resources'],
  },
  {
    id: 'constitution',
    name: 'Constitution & Civics',
    topics: ['Preamble and Fundamental Rights', 'Directive Principles and Duties', 'Union and State government', 'Judiciary', 'Panchayati Raj', 'Constitutional bodies'],
  },
  {
    id: 'economics',
    name: 'Indian Economy',
    topics: ['Planning and NITI Aayog', 'Banking and RBI', 'Budget and taxation', 'Agriculture and industry', 'Kerala economy'],
  },
  {
    id: 'physics-chemistry',
    name: 'Physics & Chemistry',
    topics: ['Motion, force and energy', 'Light, sound and electricity', 'Elements and the periodic table', 'Acids, bases and everyday chemistry'],
  },
  {
    id: 'biology',
    name: 'Biology & Public Health',
    topics: ['Human body', 'Nutrition and vitamins', 'Diseases and public health', 'Plants and environment'],
  },
  {
    id: 'current-affairs',
    name: 'Current Affairs',
    topics: ['Kerala', 'India', 'World', 'Sports', 'Awards and appointments'],
  },
  {
    id: 'arithmetic',
    name: 'Arithmetic & Mental Ability',
    topics: ['Percentage, profit and loss', 'Ratio and proportion', 'Time, speed and work', 'Simple and compound interest', 'Number series and analogies', 'Coding, directions and relations'],
  },
  {
    id: 'english',
    name: 'General English',
    topics: ['Grammar', 'Vocabulary', 'Idioms and phrases', 'One-word substitution', 'Error spotting', 'Active and passive voice'],
  },
  {
    id: 'regional-language',
    name: 'Regional Language',
    topics: ['Grammar', 'Word meanings', 'Proverbs and idioms', 'Literature', 'Translation'],
  },
  {
    id: 'arts-sports',
    name: 'Arts, Literature & Sports',
    topics: ['Kerala arts and culture', 'Malayalam literature', 'Literary and film awards', 'Sports'],
  },
  {
    id: 'it',
    name: 'Computer & IT Basics',
    topics: ['Hardware and software', 'Internet and networks', 'Cyber law', 'E-governance'],
  },
  {
    id: 'land-revenue',
    name: 'Land Revenue & Village Administration',
    topics: ['Village office functions', 'Land records and survey', 'Kerala land laws', 'Revenue administration'],
  },
  {
    id: 'police-law',
    name: 'Criminal Law & Police Administration',
    topics: ['Bharatiya Nyaya Sanhita basics', 'Bharatiya Nagarik Suraksha Sanhita basics', 'Kerala Police Act', 'Human rights'],
  },
  {
    id: 'excise-law',
    name: 'Abkari & Narcotics Law',
    topics: ['Abkari Act', 'NDPS Act', 'Excise administration', 'Effects of alcohol and drugs'],
  },
  {
    id: 'forestry',
    name: 'Forestry & Wildlife',
    topics: ['Forest types of Kerala', 'Sanctuaries and national parks', 'Forest and wildlife law', 'Environment and conservation'],
  },
  {
    id: 'fire-safety',
    name: 'Fire Safety & Disaster Management',
    topics: ['Fire science and extinguishers', 'Rescue and first aid', 'Disaster management in India'],
  },
  {
    id: 'governance',
    name: 'Governance & Public Administration',
    topics: ['Public administration basics', 'Public policy and welfare schemes', 'Ethics in public service', 'Right to Information'],
  },
  {
    id: 'science-tech',
    name: 'Science & Technology',
    topics: ['Space and defence', 'Energy and environment', 'Emerging technologies', 'Biotechnology and health'],
  },
];

const syllabus = (weights: Record<string, number>): SyllabusEntry[] =>
  Object.entries(weights).map(([subjectId, weight]) => ({ subjectId, weight }));

const TENTH_CORE = {
  'kerala-history': 14,
  'indian-history': 10,
  geography: 10,
  constitution: 10,
  economics: 4,
  'physics-chemistry': 7,
  biology: 7,
  'current-affairs': 10,
  arithmetic: 12,
  english: 8,
  'regional-language': 8,
  'arts-sports': 5,
};

const PLUS_TWO_CORE = {
  'kerala-history': 12,
  'indian-history': 10,
  geography: 9,
  constitution: 10,
  economics: 5,
  'physics-chemistry': 7,
  biology: 7,
  'current-affairs': 10,
  arithmetic: 10,
  english: 8,
  'regional-language': 7,
  it: 5,
  'arts-sports': 5,
};

const DEGREE_CORE = {
  'kerala-history': 10,
  'indian-history': 10,
  geography: 8,
  constitution: 12,
  economics: 8,
  'science-tech': 8,
  'current-affairs': 12,
  arithmetic: 12,
  english: 10,
  'regional-language': 5,
  it: 5,
  'arts-sports': 5,
};

export const EXAMS: Exam[] = [
  { id: 'ldc', name: 'LD Clerk', level: 'sslc', about: 'Lower Division Clerk in government departments', syllabus: syllabus(TENTH_CORE) },
  { id: 'lgs', name: 'Last Grade Servant', level: 'sslc', about: 'Office attendants and similar posts', syllabus: syllabus(TENTH_CORE) },
  { id: 'vfa', name: 'Village Field Assistant', level: 'sslc', about: 'Field staff in the Revenue department', syllabus: syllabus({ ...TENTH_CORE, 'land-revenue': 12, 'kerala-history': 10, 'indian-history': 8, english: 6 }) },
  { id: 'sslc-prelims', name: '10th Level Common Prelims', level: 'sslc', about: 'Screening test shared by 10th level posts', syllabus: syllabus(TENTH_CORE) },

  { id: 'cpo', name: 'Civil Police Officer', level: 'plus2', about: 'Constable-rank posts in Kerala Police', syllabus: syllabus({ ...PLUS_TWO_CORE, 'police-law': 12, 'kerala-history': 9, geography: 7, it: 3 }) },
  { id: 'excise', name: 'Civil Excise Officer', level: 'plus2', about: 'Excise department field staff', syllabus: syllabus({ ...PLUS_TWO_CORE, 'excise-law': 12, 'kerala-history': 9, geography: 7, it: 3 }) },
  { id: 'bfo', name: 'Beat Forest Officer', level: 'plus2', about: 'Field staff in the Forest department', syllabus: syllabus({ ...PLUS_TWO_CORE, forestry: 15, 'kerala-history': 9, 'indian-history': 8, it: 3 }) },
  { id: 'fro', name: 'Fire & Rescue Officer', level: 'plus2', about: 'Trainee posts in Fire and Rescue Services', syllabus: syllabus({ ...PLUS_TWO_CORE, 'fire-safety': 12, 'kerala-history': 9, geography: 7, it: 3 }) },
  { id: 'plus2-prelims', name: 'Plus Two Level Common Prelims', level: 'plus2', about: 'Screening test shared by Plus Two level posts', syllabus: syllabus(PLUS_TWO_CORE) },

  { id: 'secretariat', name: 'Secretariat / University Assistant', level: 'degree', about: 'Assistant posts in the Secretariat, PSC and universities', syllabus: syllabus(DEGREE_CORE) },
  { id: 'kas', name: 'Kerala Administrative Service', level: 'degree', about: 'KAS Officer prelims', syllabus: syllabus({ ...DEGREE_CORE, governance: 15, 'kerala-history': 12, arithmetic: 8, 'regional-language': 3, it: 3 }) },
  { id: 'si', name: 'Sub Inspector of Police', level: 'degree', about: 'Sub Inspector (Trainee) in Kerala Police', syllabus: syllabus({ ...DEGREE_CORE, 'police-law': 15, 'kerala-history': 8, economics: 5, it: 3 }) },
  { id: 'excise-inspector', name: 'Excise Inspector', level: 'degree', about: 'Inspector (Trainee) in the Excise department', syllabus: syllabus({ ...DEGREE_CORE, 'excise-law': 15, 'kerala-history': 8, economics: 5, it: 3 }) },
  { id: 'degree-prelims', name: 'Degree Level Common Prelims', level: 'degree', about: 'Screening test shared by degree level posts', syllabus: syllabus(DEGREE_CORE) },
];

export const PYQ_YEARS = [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015];

export const NEGATIVE_MARK = 1 / 3;
export const SECONDS_PER_QUESTION = 45; // 100 questions in 75 minutes
export const QUESTION_COUNTS = [10, 20, 25, 50];
export const MOCK_COUNTS = [25, 50, 100];

export const getExam = (id: string | null | undefined) => EXAMS.find((e) => e.id === id);
export const getSubject = (id: string | null | undefined) => SUBJECTS.find((s) => s.id === id);
export const getLevel = (id: string | null | undefined) => LEVELS.find((l) => l.id === id);
export const getMedium = (id: string | null | undefined) => MEDIUMS.find((m) => m.id === id);
export const examsForLevel = (level: LevelId) => EXAMS.filter((e) => e.level === level);
export const subjectsForExam = (exam: Exam) =>
  exam.syllabus.map((s) => getSubject(s.subjectId)).filter((s): s is Subject => Boolean(s));
