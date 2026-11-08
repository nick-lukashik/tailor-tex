import type { CvDocument } from '../../src/cv/cv.schemas.js'

/**
 * Made-up people only: example names, example.com contacts, fictional
 * companies. `alexExample` is small and full of characters TeX treats as
 * syntax; `jordanSample` is long enough for two pages.
 */
export const alexExample: CvDocument = {
    name: 'Alex Example',
    location: 'Lisbon, Portugal',
    phoneDisplay: '+351 900 000 000',
    phoneDigits: '+351900000000',
    headline: 'Senior Full-Stack Engineer',
    stack: 'TypeScript · React · Node.js · PostgreSQL',
    links: [
        {
            url: 'mailto:alex@example.com',
            text: 'alex@example.com',
        },
        {
            url: 'https://example.com/cv?lang=en&ref=a_b#top',
            text: 'example.com/alex_example',
        },
        {
            url: 'https://git.example.com/alex-example',
            text: 'git.example.com/alex-example',
        },
    ],
    summary: [
        'Engineer with **8+ years** building B2B & SaaS products: 100% typed APIs, $0 incidents budget and #1 on-call rota.',
        'Ships with C# and C++ when needed; writes {curly} config, a_b snake_case, ~tilde~ and ^caret^ without fear of \\backslash.',
    ],
    skills: [
        {
            label: 'Languages',
            items: [
                'TypeScript',
                'JavaScript',
                'SQL',
                'C#',
            ],
        },
        {
            label: 'Frontend',
            items: [
                'React',
                'Next.js',
                'Tailwind CSS',
            ],
        },
        {
            label: 'Backend',
            items: [
                'Node.js',
                'NestJS',
                'REST & GraphQL',
            ],
        },
        {
            label: 'Data',
            items: [
                'PostgreSQL',
                'Redis',
                'RabbitMQ',
            ],
        },
    ],
    jobs: [
        {
            title: 'Senior Engineer',
            company: 'Northwind Labs',
            dates: 'Jan 2022 – Present',
            location: 'Remote',
            description: 'Logistics SaaS for 2,000+ warehouses',
            bullets: [
                {
                    id: 'nw1',
                    text: 'Cut checkout latency by **40%** with a cache in front of the pricing service.',
                },
                {
                    id: 'nw2',
                    text: '[Lead] Owned the migration of 120 cron jobs to a queue with retries and idempotency keys.',
                },
                {
                    id: 'nw3',
                    text: 'Built the café ordering demo for Zürich and São Paulo pilots.',
                },
            ],
        },
        {
            title: 'Software Engineer',
            company: 'Contoso',
            dates: 'Mar 2019 – Dec 2021',
            location: '',
            description: '',
            bullets: [],
        },
    ],
    education: [
        {
            degree: 'BSc in Computer Science',
            school: 'Example University',
            dates: '',
        },
    ],
    languages: [
        {
            name: 'English',
            level: 'C1',
        },
        {
            name: 'Portuguese',
            level: 'Native',
        },
    ],
    pdf: {
        title: 'Alex Example - Senior Full-Stack Engineer - CV',
        subject: 'Senior Full-Stack Engineer resume: TypeScript, React & Node.js',
        keywords: [
            'TypeScript',
            'React',
            'Node.js',
            'C#',
        ],
    },
}

const AREAS = [
    'the order service',
    'the billing module',
    'the search API',
    'the admin panel',
    'the reporting pipeline',
    'the notification service',
]

/** A generic, fictional bullet of about two printed lines. */
const bullet = (id: string, index: number) => ({
    id,
    text: `Improved **${AREAS[index % AREAS.length]}** step ${index + 1}: clearer contracts between services, automated tests for the main flows, and dashboards that show the team where requests slow down.`,
})

const bullets = (prefix: string, count: number, offset: number) =>
    Array.from(
        {
            length: count,
        },
        (_, index) => bullet(`${prefix}${index + 1}`, offset + index),
    )

export const jordanSample: CvDocument = {
    name: 'Jordan Sample',
    location: 'Berlin, Germany',
    phoneDisplay: '+49 30 0000 0000',
    phoneDigits: '+4930000000000',
    headline: 'Senior Software Engineer',
    stack: 'TypeScript · React · Node.js · PostgreSQL',
    links: [
        {
            url: 'mailto:jordan.sample@example.com',
            text: 'jordan.sample@example.com',
        },
        {
            url: 'https://example.com/jordan-sample',
            text: 'example.com/jordan-sample',
        },
    ],
    summary: [
        'Software engineer with **10+ years** on web products: APIs, web apps and the tooling around them. Works best where product questions meet technical ones, from the first sketch to production.',
        'Leads small teams through design reviews and code review, and keeps the hard parts of architecture and debugging hands-on.',
    ],
    skills: [
        'Languages',
        'Frontend',
        'Backend',
        'Data',
        'Messaging',
        'Testing',
        'DevOps',
        'Practices',
    ].map((label, index) => ({
        label,
        items: Array.from(
            {
                length: 6,
            },
            (_, item) => `${label} tool ${index * 6 + item + 1}`,
        ),
    })),
    jobs: [
        {
            title: 'Senior Software Engineer',
            company: 'Fabrikam',
            dates: 'Mar 2022 – Present',
            location: 'Remote',
            description: 'Fictional e-commerce platform',
            bullets: bullets('f', 8, 0),
        },
        {
            title: 'Software Engineer',
            company: 'Wingtip',
            dates: 'Feb 2019 – Feb 2022',
            location: 'Remote',
            description: 'Fictional CRM for small businesses',
            bullets: bullets('w', 6, 8),
        },
        {
            title: 'Full-Stack Engineer',
            company: 'Litware',
            dates: 'Jan 2017 – Jan 2019',
            location: 'Berlin',
            description: 'Fictional fulfilment platform',
            bullets: bullets('l', 5, 14),
        },
        {
            title: 'Web Developer',
            company: 'Proseware',
            dates: 'Jun 2015 – Dec 2016',
            location: 'Berlin',
            description: 'Fictional web agency',
            bullets: bullets('p', 3, 19),
        },
    ],
    education: [
        {
            degree: 'BSc in Computer Science',
            school: 'Example Technical University',
            dates: 'Sep 2011 – Jun 2015',
        },
    ],
    languages: [
        {
            name: 'English',
            level: 'C1',
        },
        {
            name: 'German',
            level: 'Native',
        },
    ],
    pdf: {
        title: '',
        subject: 'Senior Software Engineer resume',
        keywords: [
            'TypeScript',
            'React',
            'Node.js',
        ],
    },
}
