import { motion } from 'framer-motion'

const Schedule = () => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3 }}
      className='max-w-6xl mx-auto px-4 pt-24 pb-12 flex flex-col items-center text-center gap-12'
    >
      <h1 className='font-bold text-gray-100' style={{ fontSize: '40px', fontFamily: 'Helvetica, Arial, sans-serif' }}>
        Schedule Planner (Coming Soon)
      </h1>
    </motion.div>
  )
}

export default Schedule
