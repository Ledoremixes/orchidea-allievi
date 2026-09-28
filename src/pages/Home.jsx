import { useOutletContext } from "react-router-dom";
import Dashboard from "./Dashboard.jsx";
import TeacherHome from "./TeacherHome.jsx";

export default function Home() {
  const context = useOutletContext();
  const teacherExperience = Boolean(context?.teacher) && !context?.isAdmin;
  return teacherExperience ? <TeacherHome /> : <Dashboard />;
}
